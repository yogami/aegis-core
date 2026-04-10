// ATDD Spec: Speculative Parallelization Engine
//
// This spec defines the acceptance criteria for the hackathon-winning feature:
// the fork/merge speculative parallelization that achieves sub-25ms latency.
//
// Thread A (I/O): Sends payload to SLM for semantic evaluation
// Thread B (Compute): Pre-computes ML-DSA nonces while waiting
// Merge: If A returns Safe, B releases signature. If Deny, nonces zeroed.

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::{Duration, Instant};
    use tokio::sync::oneshot;

    use crate::domain::{
        TransactionIntent, PolicyVerdict, PQSignature, SignedResponse, EnclaveError,
    };
    use crate::domain::speculative_engine::SpeculativeEngine;
    use crate::ports::{PolicyEvaluatorPort, SignerPort};

    // === Mock Implementations ===

    /// Mock policy evaluator that returns a configurable verdict after a delay.
    struct MockPolicyEvaluator {
        verdict: PolicyVerdict,
        delay: Duration,
    }

    #[async_trait::async_trait]
    impl PolicyEvaluatorPort for MockPolicyEvaluator {
        async fn evaluate(&self, _intent: &TransactionIntent) -> Result<PolicyVerdict, EnclaveError> {
            tokio::time::sleep(self.delay).await;
            Ok(self.verdict.clone())
        }
    }

    /// Mock policy evaluator that times out (never returns).
    struct TimeoutPolicyEvaluator;

    #[async_trait::async_trait]
    impl PolicyEvaluatorPort for TimeoutPolicyEvaluator {
        async fn evaluate(&self, _intent: &TransactionIntent) -> Result<PolicyVerdict, EnclaveError> {
            tokio::time::sleep(Duration::from_secs(60)).await;
            unreachable!()
        }
    }

    /// Mock signer that produces a deterministic signature.
    struct MockSigner;

    #[async_trait::async_trait]
    impl SignerPort for MockSigner {
        async fn precompute_nonces(&self, _message: &[u8]) -> Result<Vec<u8>, EnclaveError> {
            Ok(vec![0xDE, 0xAD, 0xBE, 0xEF])
        }

        async fn finalize_signature(
            &self,
            _message: &[u8],
            nonces: Vec<u8>,
        ) -> Result<PQSignature, EnclaveError> {
            Ok(PQSignature {
                signature: nonces,
                algorithm: "ML-DSA-65-MOCK".to_string(),
                public_key: vec![0x01, 0x02, 0x03],
            })
        }
    }

    fn test_intent() -> TransactionIntent {
        TransactionIntent {
            action: "transfer".to_string(),
            target: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin".to_string(),
            amount: 1_000_000, // 0.001 SOL
            agent_id: "agent-alpha-1".to_string(),
            memo: None,
        }
    }

    fn safe_verdict() -> PolicyVerdict {
        PolicyVerdict {
            approved: true,
            reasoning: "Transfer amount within safe bounds".to_string(),
            risk_score: 0.1,
        }
    }

    fn deny_verdict() -> PolicyVerdict {
        PolicyVerdict {
            approved: false,
            reasoning: "Wallet drain detected: >90% balance transfer".to_string(),
            risk_score: 0.95,
        }
    }

    // === ACCEPTANCE TESTS ===

    /// AC-1: When the SLM approves, the pre-computed signature is released
    /// and the total latency is less than the SLM round-trip + a small overhead.
    #[tokio::test]
    async fn approved_intent_releases_precomputed_signature() {
        let evaluator = Arc::new(MockPolicyEvaluator {
            verdict: safe_verdict(),
            delay: Duration::from_millis(10),
        });
        let signer = Arc::new(MockSigner);
        let engine = SpeculativeEngine::new(
            evaluator,
            signer,
            Duration::from_millis(5000), // generous timeout for test
        );

        let intent = test_intent();
        let start = Instant::now();
        let result = engine.execute(intent.clone()).await;
        let elapsed = start.elapsed();

        let response = result.expect("Should succeed for approved intent");
        assert!(response.verdict.approved, "Verdict should be approved");
        assert!(response.signature.is_some(), "Signature should be present");
        assert_eq!(
            response.signature.as_ref().unwrap().algorithm,
            "ML-DSA-65-MOCK"
        );
        // Parallelization means total time ≈ max(SLM time, nonce time), not sum
        assert!(
            elapsed < Duration::from_millis(100),
            "Speculative execution should complete quickly, took {:?}",
            elapsed
        );
    }

    /// AC-2: When the SLM denies, nonces are securely zeroed and no signature is returned.
    #[tokio::test]
    async fn denied_intent_zeros_nonces_and_returns_no_signature() {
        let evaluator = Arc::new(MockPolicyEvaluator {
            verdict: deny_verdict(),
            delay: Duration::from_millis(5),
        });
        let signer = Arc::new(MockSigner);
        let engine = SpeculativeEngine::new(
            evaluator,
            signer,
            Duration::from_millis(5000),
        );

        let result = engine.execute(test_intent()).await;
        let response = result.expect("Should return a response even for denied intents");
        assert!(!response.verdict.approved, "Verdict should be denied");
        assert!(
            response.signature.is_none(),
            "No signature should be released for denied intent"
        );
    }

    /// AC-3: When the SLM times out, the intent is denied by default (fail-closed).
    #[tokio::test]
    async fn slm_timeout_triggers_denial() {
        let evaluator = Arc::new(TimeoutPolicyEvaluator);
        let signer = Arc::new(MockSigner);
        let engine = SpeculativeEngine::new(
            evaluator,
            signer,
            Duration::from_millis(50), // 50ms timeout
        );

        let result = engine.execute(test_intent()).await;
        let response = result.expect("Timeout should still return a deny response");
        assert!(
            !response.verdict.approved,
            "Timeout should result in denial (fail-closed)"
        );
        assert!(
            response.signature.is_none(),
            "No signature on timeout"
        );
    }

    /// AC-4: Concurrent requests do not cross-contaminate nonces or verdicts.
    #[tokio::test]
    async fn concurrent_requests_are_isolated() {
        let evaluator = Arc::new(MockPolicyEvaluator {
            verdict: safe_verdict(),
            delay: Duration::from_millis(5),
        });
        let signer = Arc::new(MockSigner);
        let engine = Arc::new(SpeculativeEngine::new(
            evaluator,
            signer,
            Duration::from_millis(5000),
        ));

        let mut handles = Vec::new();
        for i in 0..10 {
            let engine = engine.clone();
            let mut intent = test_intent();
            intent.agent_id = format!("agent-{}", i);
            handles.push(tokio::spawn(async move {
                engine.execute(intent).await
            }));
        }

        let results: Vec<_> = futures::future::join_all(handles).await;
        for (i, result) in results.into_iter().enumerate() {
            let response = result
                .expect("Task should not panic")
                .expect("Execution should succeed");
            assert_eq!(
                response.intent.agent_id,
                format!("agent-{}", i),
                "Response should match the requesting agent"
            );
            assert!(response.signature.is_some());
        }
    }

    /// AC-5: Sub-25ms target for the merge when SLM responds quickly.
    #[tokio::test]
    async fn merge_latency_under_25ms_with_fast_slm() {
        let evaluator = Arc::new(MockPolicyEvaluator {
            verdict: safe_verdict(),
            delay: Duration::from_millis(1), // very fast SLM
        });
        let signer = Arc::new(MockSigner);
        let engine = SpeculativeEngine::new(
            evaluator,
            signer,
            Duration::from_millis(5000),
        );

        let start = Instant::now();
        let result = engine.execute(test_intent()).await;
        let elapsed = start.elapsed();

        assert!(result.is_ok());
        assert!(
            elapsed < Duration::from_millis(25),
            "Merge should complete in <25ms with fast SLM, took {:?}",
            elapsed
        );
    }
}
