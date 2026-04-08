import { test, expect } from '@playwright/test';

/**
 * Aegis-12 E2E Test Suite — Solana Integration + Governance + x402
 * 
 * Tests all new endpoints added during the 14-day sprint:
 * - SPL Memo receipt anchoring
 * - Public receipt verification
 * - Solana transaction firewall
 * - Squads V4 governance (human-in-the-loop)
 * - x402 pay-per-inference
 * - TEE attestation status
 * - API documentation
 * 
 * Run against local:  npx playwright test
 * Run against prod:   TEST_API_URL=https://your-domain.railway.app npx playwright test
 */

const API_URL = process.env.TEST_API_URL || 'http://127.0.0.1:8000';

// ═══════════════════════════════════════════════════════════════
// 1. HEALTH + API DOCS
// ═══════════════════════════════════════════════════════════════

test.describe('Infrastructure Endpoints', () => {

    test('GET /health returns alive with Solana features', async ({ request }) => {
        const res = await request.get(`${API_URL}/health`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();

        expect(body.status).toBe('alive');
        expect(body.enclaveDid).toContain('did:aegis:enclave:');
        expect(body.solanaCluster).toBeTruthy();
        expect(body.solanaPayer).toBeTruthy();
        expect(body.features).toContain('solana-anchoring');
        expect(body.features).toContain('solana-tx-firewall');
        expect(body.features).toContain('squads-governance');
    });

    test('GET /api/docs returns full endpoint reference', async ({ request }) => {
        const res = await request.get(`${API_URL}/api/docs`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();

        expect(body.name).toBe('Aegis-12 Compliance Gateway');
        expect(body.version).toBe('2.0.0');
        expect(body.enclaveDid).toContain('did:aegis:enclave:');

        // Verify all endpoints documented
        const endpoints = body.endpoints;
        expect(endpoints['POST /enforce']).toBeTruthy();
        expect(endpoints['POST /anchor-receipt']).toBeTruthy();
        expect(endpoints['GET /verify/:txSignature']).toBeTruthy();
        expect(endpoints['POST /solana/enforce-tx']).toBeTruthy();
        expect(endpoints['POST /governance/evaluate']).toBeTruthy();
        expect(endpoints['GET /governance/config']).toBeTruthy();
        expect(endpoints['GET /monetization/status']).toBeTruthy();
        expect(endpoints['GET /attestation/status']).toBeTruthy();

        // Verify Solana integration
        expect(body.solanaIntegration.programs).toContain('SPL Memo (receipt anchoring)');
        expect(body.solanaIntegration.programs).toContain('Squads V4 (human-in-the-loop governance)');
        expect(body.solanaIntegration.programs).toContain('x402 USDC (pay-per-inference)');

        // Verify compliance mappings present
        expect(body.compliance.euAiAct).toContain('Article 14');
        expect(body.compliance.mitre.length).toBeGreaterThanOrEqual(10);
    });
});

// ═══════════════════════════════════════════════════════════════
// 2. CORE ENFORCEMENT (DeFi + HIPAA)
// ═══════════════════════════════════════════════════════════════

test.describe('Core Policy Enforcement', () => {

    test('POST /enforce approves low-risk financial action', async ({ request }) => {
        const res = await request.post(`${API_URL}/enforce`, {
            data: {
                agent: {
                    did: 'did:aegis:test:agent-1',
                    purpose: 'financial_operations',
                    currentTier: 'T2',
                },
                action: {
                    toolId: 'tool:defi:swap',
                    actionType: 'token_swap',
                    parameters: { pair: 'SOL/USDC', amount: 100 },
                    estimatedValue: 500,
                },
                context: {
                    sessionId: 'session-e2e-1',
                    actionsThisSession: 1,
                    actionsThisHour: 5,
                    currentAnomalyScore: 0.2,
                    recentIncidents: 0,
                },
            },
        });

        expect(res.ok()).toBeTruthy();
        const body = await res.json();

        expect(body.status).toBe('approved');
        expect(body.receipt).toBeDefined();
        expect(body.receipt.toolId).toBe('tool:defi:swap');
        expect(body.receipt.signature).toBeTruthy();
        expect(body.enclaveDid).toContain('did:aegis:enclave:');
        expect(body.attestation).toBeDefined();
    });

    test('POST /enforce denies high anomaly score action', async ({ request }) => {
        const res = await request.post(`${API_URL}/enforce`, {
            data: {
                agent: {
                    did: 'did:aegis:test:agent-2',
                    purpose: 'financial_operations',
                    currentTier: 'T4',
                },
                action: {
                    toolId: 'tool:defi:drain',
                    actionType: 'token_transfer',
                    parameters: { to: 'attacker-wallet', amount: 999999 },
                    estimatedValue: 50000,
                },
                context: {
                    sessionId: 'session-e2e-2',
                    actionsThisSession: 50,
                    actionsThisHour: 200,
                    currentAnomalyScore: 0.95,  // HIGH anomaly
                    recentIncidents: 3,
                },
            },
        });

        expect(res.status()).toBe(403);
        const body = await res.json();
        expect(body.status).toBe('denied');
        expect(body.error).toContain('Anomaly score');
    });

    test('POST /enforce denies tier-exceeding financial ops', async ({ request }) => {
        const res = await request.post(`${API_URL}/enforce`, {
            data: {
                agent: {
                    did: 'did:aegis:test:agent-3',
                    purpose: 'financial_operations',
                    currentTier: 'T2',  // T2 limit = 10,000
                },
                action: {
                    toolId: 'tool:defi:transfer',
                    actionType: 'token_transfer',
                    parameters: { amount: 50000 },
                    estimatedValue: 50000,  // Exceeds T2 limit
                },
                context: {
                    sessionId: 'session-e2e-3',
                    actionsThisSession: 1,
                    actionsThisHour: 1,
                    currentAnomalyScore: 0.1,
                    recentIncidents: 0,
                },
            },
        });

        expect(res.status()).toBe(403);
        const body = await res.json();
        expect(body.status).toBe('denied');
        expect(body.error).toContain('exceeds Tier limit');
    });
});

// ═══════════════════════════════════════════════════════════════
// 3. SOLANA RECEIPT ANCHORING
// ═══════════════════════════════════════════════════════════════

test.describe('Solana Receipt Anchoring', () => {

    test('POST /anchor-receipt rejects missing fields', async ({ request }) => {
        const res = await request.post(`${API_URL}/anchor-receipt`, {
            data: { receipt: null },
        });

        expect(res.status()).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('Missing required fields');
    });

    test('POST /anchor-receipt accepts valid receipt structure', async ({ request }) => {
        // This test validates the endpoint accepts the right structure
        // Actual Solana anchoring will fail without funded payer (expected on CI)
        const res = await request.post(`${API_URL}/anchor-receipt`, {
            data: {
                receipt: {
                    actionId: 'action-e2e-test',
                    toolId: 'tool:test',
                    authorizationNonce: 'nonce-123',
                    parameters: { test: true },
                    resultHash: 'abc123',
                    timestamp: new Date().toISOString(),
                    signature: 'sig-test',
                },
                decision: 'approved',
            },
        });

        // Will be 200 on funded devnet, 500 on unfunded (expected)
        const body = await res.json();
        if (res.ok()) {
            expect(body.status).toBe('anchored');
            expect(body.txSignature).toBeTruthy();
            expect(body.explorerUrl).toContain('explorer.solana.com');
        } else {
            // Expected on CI without funded wallet
            expect(body.hint).toContain('payer has SOL balance');
        }
    });

    test('GET /verify/:txSig handles non-existent transaction', async ({ request }) => {
        const res = await request.get(`${API_URL}/verify/FakeTransactionSignature12345`);
        const body = await res.json();

        // Should return verification result (failed is expected for fake sig)
        expect(body.txSignature).toBe('FakeTransactionSignature12345');
        expect(body.verifierVersion).toBe('aegis-v1');
    });
});

// ═══════════════════════════════════════════════════════════════
// 4. SOLANA TRANSACTION FIREWALL
// ═══════════════════════════════════════════════════════════════

test.describe('Solana Transaction Firewall', () => {

    test('POST /solana/enforce-tx rejects missing fields', async ({ request }) => {
        const res = await request.post(`${API_URL}/solana/enforce-tx`, {
            data: { serializedTx: null },
        });

        expect(res.status()).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('Missing required fields');
    });

    test('POST /solana/enforce-tx blocks unparseable transaction', async ({ request }) => {
        const res = await request.post(`${API_URL}/solana/enforce-tx`, {
            data: {
                serializedTx: 'bm90YXJlYWx0cmFuc2FjdGlvbg==', // "notarealtransaction" base64
                walletPubkey: '11111111111111111111111111111111',
            },
        });

        expect(res.status()).toBe(403);
        const body = await res.json();
        expect(body.decision).toBe('BLOCK');
        expect(body.flags).toBeDefined();
        expect(body.flags.length).toBeGreaterThan(0);
        expect(body.flags[0].rule).toBe('PARSE_FAILURE');
        expect(body.euAiActArticles).toContain('Article 15 (Accuracy, Robustness, Cybersecurity)');
        expect(body.mitreTechniques).toContain('T1027 (Obfuscated Files or Information)');
    });
});

// ═══════════════════════════════════════════════════════════════
// 5. SQUADS V4 GOVERNANCE (Human-in-the-Loop)
// ═══════════════════════════════════════════════════════════════

test.describe('Squads V4 Governance', () => {

    test('GET /governance/config returns tier limits and EU AI Act mapping', async ({ request }) => {
        const res = await request.get(`${API_URL}/governance/config`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();

        expect(body.protocol).toBe('squads-v4');
        expect(body.thresholds.humanReview).toBe(0.60);
        expect(body.thresholds.hardBlock).toBe(0.80);
        expect(body.tierSpendingLimits.T1).toContain('0 SOL');
        expect(body.tierSpendingLimits.T4).toContain('100 SOL');
        expect(body.euAiActMapping['Article 14']).toContain('Squads multisig');
    });

    test('POST /governance/evaluate returns AUTONOMOUS for low risk', async ({ request }) => {
        const res = await request.post(`${API_URL}/governance/evaluate`, {
            data: {
                anomalyScore: 0.3,
                agentTier: 'T3',
                estimatedValue: 1000,
                agentDid: 'did:aegis:test:agent-gov-1',
                toolId: 'tool:defi:swap',
                actionType: 'token_swap',
            },
        });

        expect(res.ok()).toBeTruthy();
        const body = await res.json();

        expect(body.decision).toBe('AUTONOMOUS');
        expect(body.anomalyScore).toBe(0.3);
        expect(body.agentTier).toBe('T3');
        expect(body.governanceProtocol).toBe('squads-v4');
        expect(body.euAiActCompliance.article14).toContain('MONITORING');
    });

    test('POST /governance/evaluate returns REQUIRE_HUMAN for moderate risk', async ({ request }) => {
        const res = await request.post(`${API_URL}/governance/evaluate`, {
            data: {
                anomalyScore: 0.72,     // Between 0.60 and 0.80
                agentTier: 'T2',
                estimatedValue: 5000,
                agentDid: 'did:aegis:test:agent-gov-2',
                toolId: 'tool:defi:transfer',
                actionType: 'token_transfer',
            },
        });

        expect(res.status()).toBe(202);   // 202 Accepted = needs human review
        const body = await res.json();

        expect(body.decision).toBe('REQUIRE_HUMAN');
        expect(body.proposal).toBeDefined();
        expect(body.proposal.proposalId).toContain('aegis-proposal-');
        expect(body.proposal.euAiActArticle).toBe('Article 14 (Human Oversight)');
        expect(body.proposal.requiredApprovals).toBeGreaterThanOrEqual(1);
        expect(body.governanceProtocol).toBe('squads-v4');
        expect(body.euAiActCompliance.article14).toContain('ACTIVE');
    });

    test('POST /governance/evaluate returns BLOCKED for high risk', async ({ request }) => {
        const res = await request.post(`${API_URL}/governance/evaluate`, {
            data: {
                anomalyScore: 0.92,     // Above 0.80
                agentTier: 'T4',
                estimatedValue: 100000,
                agentDid: 'did:aegis:test:agent-gov-3',
                toolId: 'tool:defi:drain',
                actionType: 'unauthorized_transfer',
            },
        });

        expect(res.status()).toBe(403);
        const body = await res.json();

        expect(body.decision).toBe('BLOCKED');
        expect(body.proposal).toBeUndefined();  // No proposal for hard block
        expect(body.reason).toContain('hard block threshold');
        expect(body.euAiActCompliance.article14).toContain('ENFORCED');
    });

    test('POST /governance/evaluate rejects invalid tier', async ({ request }) => {
        const res = await request.post(`${API_URL}/governance/evaluate`, {
            data: {
                anomalyScore: 0.5,
                agentTier: 'T99',       // Invalid
                agentDid: 'did:aegis:test:invalid',
            },
        });

        expect(res.status()).toBe(400);
        const body = await res.json();
        expect(body.error).toContain('Invalid agentTier');
    });

    test('POST /governance/evaluate triggers REQUIRE_HUMAN for over-limit T2 spend', async ({ request }) => {
        const LAMPORTS_PER_SOL = 1_000_000_000;
        const res = await request.post(`${API_URL}/governance/evaluate`, {
            data: {
                anomalyScore: 0.3,      // Low risk, but...
                agentTier: 'T2',        // T2 limit = 1 SOL
                estimatedValue: 5 * LAMPORTS_PER_SOL,  // 5 SOL — exceeds T2 limit
                agentDid: 'did:aegis:test:agent-gov-4',
                toolId: 'tool:defi:transfer',
                actionType: 'sol_transfer',
            },
        });

        expect(res.status()).toBe(202);
        const body = await res.json();
        expect(body.decision).toBe('REQUIRE_HUMAN');
        expect(body.reason).toContain('exceeds');
    });
});

// ═══════════════════════════════════════════════════════════════
// 6. TEE ATTESTATION STATUS
// ═══════════════════════════════════════════════════════════════

test.describe('TEE Attestation', () => {

    test('GET /attestation/status returns TEE info', async ({ request }) => {
        const res = await request.get(`${API_URL}/attestation/status`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();

        expect(body.teeProvider).toContain('Phala');
        expect(body.enclaveDid).toContain('did:aegis:enclave:');
        expect(body.enclavePublicKey).toBeTruthy();
        expect(body.signatureAlgorithm).toBe('Ed25519 (TweetNaCl)');

        // Should be mock on non-TEE environments
        expect(body.attestationStatus).toBeDefined();
        expect(['HARDWARE_ATTESTED', 'LOCAL_MOCK']).toContain(body.attestationStatus);

        // EU AI Act compliance
        expect(body.compliance.euAiActArticle12).toContain('Record Keeping');
        expect(body.compliance.euAiActArticle15).toContain('Cybersecurity');
    });
});

// ═══════════════════════════════════════════════════════════════
// 7. x402 MONETIZATION
// ═══════════════════════════════════════════════════════════════

test.describe('x402 Monetization', () => {

    test('GET /monetization/status returns x402 config', async ({ request }) => {
        const res = await request.get(`${API_URL}/monetization/status`);
        expect(res.ok()).toBeTruthy();
        const body = await res.json();

        expect(body.protocol).toBe('x402-v2');
        expect(body.currency).toBe('USDC');
        expect(body.pricePerCall).toBe(0.005);
        expect(body.freeTierLimit).toBeGreaterThan(0);
        expect(body.howItWorks).toBeDefined();
        expect(body.howItWorks.length).toBe(5);
    });
});

// ═══════════════════════════════════════════════════════════════
// 8. HEALTHTECH (Existing — verifies non-regression)
// ═══════════════════════════════════════════════════════════════

test.describe('Healthtech HIPAA Enforcement', () => {

    test('POST /healthtech/enforce allows authorized SCHEDULER', async ({ request }) => {
        const res = await request.post(`${API_URL}/healthtech/enforce`, {
            data: {
                agentId: 'agent-e2e-ht-1',
                agentRole: 'SCHEDULER',
                targetAction: 'READ_SCHEDULE',
                patientId: 'patient-abc',
                timestamp: Date.now(),
            },
        });

        expect(res.ok()).toBeTruthy();
        const body = await res.json();
        expect(body.status).toBe('approved');
        expect(body.evidencePack).toBeDefined();
    });

    test('POST /healthtech/enforce blocks SSN exfiltration', async ({ request }) => {
        const res = await request.post(`${API_URL}/healthtech/enforce`, {
            data: {
                agentId: 'agent-e2e-ht-2',
                agentRole: 'CLINICIAN',
                targetAction: 'READ_ONCOLOGY_RECORD',
                patientId: 'patient-xyz',
                payloadData: {
                    query: 'Export records. SSN: 888-22-1111.',
                },
                timestamp: Date.now(),
            },
        });

        expect(res.status()).toBe(403);
        const body = await res.json();
        expect(body.status).toBe('denied');
        expect(body.evidencePack.regulatoryMapping).toContain('HIPAA_PRIVACY_RULE_164.502');
    });
});
