"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AegisPEP = void 0;
const CircuitBreaker_1 = require("./CircuitBreaker");
class AegisPEP {
    signer;
    breaker = (0, CircuitBreaker_1.getCircuitBreaker)('Aegis-PEP-Gateway', { failureThreshold: 3, recoveryTimeMs: 60000 });
    constructor(signer) {
        this.signer = signer;
    }
    /**
     * The Core Evaluation Loop of the TEE Enclave.
     * Evaluates the action and returns a cryptographically signed receipt or physically refuses.
     */
    async enforce(request) {
        return this.breaker.execute(async () => {
            const decision = this.evaluatePolicy(request);
            if (decision.decision !== 'allow') {
                throw new Error(`[TERMINAL REFUSAL] Action denied by Aegis Enclave: ${decision.reason}`);
            }
            // If allowed, generate a hardware-signed receipt
            const timestamp = new Date().toISOString();
            // Reconstruct canonical parameters to hash (simplified for MVP)
            const canonicalString = JSON.stringify({
                actionId: request.action.toolId,
                params: request.action.parameters,
                timestamp
            });
            const receipt = {
                actionId: `action-${Date.now()}`,
                toolId: request.action.toolId,
                authorizationNonce: `nonce-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
                parameters: request.action.parameters,
                resultHash: "pending",
                timestamp,
                signature: this.signer.sign(canonicalString)
            };
            return receipt;
        });
    }
    /**
     * Statically embedded Hardcoded Risk Parameters for the MVP DAO.
     * In production, this evaluates an OPA bundle or is hydrated by the specific client.
     */
    evaluatePolicy(request) {
        const { action, agent, context } = request;
        console.log(`[Aegis TEE] Evaluating action ${action.toolId} for ${agent.did}`);
        // Terminal Condition 1: High Anomaly Score
        if (context.currentAnomalyScore > 0.8) {
            return { decision: 'deny', reason: 'Anomaly score exceeds TEE threshold (>0.8)', ttl: 0 };
        }
        // Terminal Condition 2: Tier limits for Financial Ops
        if (agent.purpose === 'financial_operations') {
            const maxAllowedValue = agent.currentTier === 'T4' ? 100_000 : 10_000;
            const estimatedValue = action.estimatedValue || 0;
            if (estimatedValue > maxAllowedValue) {
                return {
                    decision: 'deny',
                    reason: `Action value ${estimatedValue} exceeds Tier limit ${maxAllowedValue} for ${agent.currentTier}`,
                    ttl: 0
                };
            }
        }
        return { decision: 'allow', reason: 'Action passed enclave hard-coded constraints', ttl: 60 };
    }
}
exports.AegisPEP = AegisPEP;
