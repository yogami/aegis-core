import { describe, it, expect } from 'vitest';
import phalaEntrypoint from '../../src/phala-entry';
import { AgentPurpose, PolicyEvaluationRequest, TrustTier } from '../../src/types';

describe('AegisPEP & Phala Entrypoint (E2E)', () => {

    const baseAgent = {
        did: "did:web:noahai.agent.testbot",
        purpose: AgentPurpose.FINANCIAL_OPERATIONS,
        currentTier: TrustTier.T4
    };

    it('should approve a legitimate trading request within policy bounds', async () => {
        const authorizedPayload: PolicyEvaluationRequest = {
            agent: baseAgent,
            action: {
                toolId: "JupiterTradeExecution",
                actionType: "swap",
                parameters: {
                    tokenIn: "USDC",
                    tokenOut: "SOL",
                    amountIn: 1000 // Safely under limit
                },
                estimatedValue: 1000
            },
            context: {
                sessionId: "session-1",
                actionsThisSession: 2,
                actionsThisHour: 5,
                currentAnomalyScore: 0.1,
                recentIncidents: 0
            }
        };

        const responseString = await phalaEntrypoint(JSON.stringify(authorizedPayload));
        const res = JSON.parse(responseString);

        expect(res.status).toBe('approved');
        expect(res.receipt).toBeDefined();
        // Check TEE cryptographic signature is present
        expect(res.receipt.signature).toBeDefined();
        expect(res.enclaveDid).toMatch(/^did:aegis:enclave/i);
    });

    it('should enact a TERMINAL REFUSAL when T4 maximum value limit is exceeded', async () => {
        const payload: PolicyEvaluationRequest = {
            agent: baseAgent,
            action: {
                toolId: "JupiterTradeExecution",
                actionType: "swap",
                parameters: { amountIn: 150_000 },
                estimatedValue: 150_000 // T4 Limit is 100_000
            },
            context: {
                sessionId: "session-2",
                actionsThisSession: 1,
                actionsThisHour: 1,
                currentAnomalyScore: 0.1,
                recentIncidents: 0
            }
        };

        const responseString = await phalaEntrypoint(JSON.stringify(payload));
        const res = JSON.parse(responseString);

        expect(res.status).toBe('denied');
        expect(res.error).toContain('[TERMINAL REFUSAL]');
        expect(res.error).toContain('exceeds Tier limit');
    });

    it('should enact a TERMINAL REFUSAL when Anomaly score is too high', async () => {
        const payload: PolicyEvaluationRequest = {
            agent: baseAgent,
            action: {
                toolId: "SolanaTreasuryTransfer",
                actionType: "withdraw",
                parameters: { amount: 50 },
                estimatedValue: 50
            },
            context: {
                sessionId: "session-3",
                actionsThisSession: 500, // Highly anomalous
                actionsThisHour: 5000,
                currentAnomalyScore: 0.95, // Above 0.8 limit
                recentIncidents: 1
            }
        };

        const responseString = await phalaEntrypoint(JSON.stringify(payload));
        const res = JSON.parse(responseString);

        expect(res.status).toBe('denied');
        expect(res.error).toContain('[TERMINAL REFUSAL]');
        expect(res.error).toContain('Anomaly score exceeds TEE threshold');
    });

});
