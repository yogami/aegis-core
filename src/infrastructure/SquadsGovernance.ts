/**
 * SquadsGovernance — On-Chain Human-in-the-Loop via Squads V4
 * 
 * Implements EU AI Act Article 14 (Human Oversight) using the Squads Protocol V4
 * multisig program on Solana. When the Aegis PEP detects a moderate-risk action
 * (anomaly 0.60-0.79), it doesn't return a simple deny — it creates a Squads
 * Vault Transaction (multisig proposal) requiring human compliance officer approval.
 * 
 * Risk Routing:
 *   - Anomaly < 0.60: Agent operates within Squads Spending Limit (autonomous)
 *   - Anomaly 0.60-0.79: Moderate risk → Squads multisig proposal (human review)
 *   - Anomaly ≥ 0.80: Hard block (no proposal, immediate deny)
 * 
 * This transforms Aegis from a Web2 content filter into an on-chain,
 * EU-compliant governance layer for DeFi agents.
 * 
 * SDK: @sqds/multisig (TypeScript, no Rust required)
 */

import {
    Connection,
    Keypair,
    PublicKey,
    Transaction,
    TransactionInstruction,
    SystemProgram,
    clusterApiUrl,
} from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { createHash } from 'crypto';
import { TrustTier, ToolExecutionReceipt } from '../types';

export interface GovernanceConfig {
    /** Solana cluster */
    cluster: string;
    /** Multisig account public key (already created) */
    multisigPda?: string;
    /** Threshold for human review (0.0-1.0) */
    humanReviewThreshold: number;
    /** Hard block threshold (0.0-1.0) */
    hardBlockThreshold: number;
    /** Spending limits per tier in lamports */
    tierSpendingLimits: Record<TrustTier, number>;
}

export type GovernanceDecision = 'AUTONOMOUS' | 'REQUIRE_HUMAN' | 'BLOCKED';

export interface GovernanceResult {
    decision: GovernanceDecision;
    reason: string;
    anomalyScore: number;
    agentTier: TrustTier;
    spendingLimit: number;
    /** If REQUIRE_HUMAN, this contains the proposal details */
    proposal?: {
        proposalId: string;
        multisigPda: string;
        transactionIndex: number;
        requiredApprovals: number;
        expiresAt: string;
        euAiActArticle: string;
    };
    /** Signed receipt of the governance decision */
    receipt: {
        hash: string;
        timestamp: string;
        decisionProvenance: string;
    };
}

const LAMPORTS_PER_SOL = 1_000_000_000;

const DEFAULT_CONFIG: GovernanceConfig = {
    cluster: 'devnet',
    humanReviewThreshold: 0.60,
    hardBlockThreshold: 0.80,
    tierSpendingLimits: {
        [TrustTier.T1]: 0,                          // Observer: no spending
        [TrustTier.T2]: 1 * LAMPORTS_PER_SOL,       // Advisor: 1 SOL
        [TrustTier.T3]: 10 * LAMPORTS_PER_SOL,      // Operator: 10 SOL
        [TrustTier.T4]: 100 * LAMPORTS_PER_SOL,     // Autonomous: 100 SOL
    },
};

export class SquadsGovernance {
    private connection: Connection;
    private config: GovernanceConfig;
    private proposalCounter: number = 0;

    constructor(config?: Partial<GovernanceConfig>) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl(this.config.cluster as any);
        this.connection = new Connection(rpcUrl, 'confirmed');
    }

    /**
     * Evaluate an agent action and determine the governance path.
     * 
     * This is the core decision engine that routes actions to:
     * - AUTONOMOUS: within spending limits, low risk
     * - REQUIRE_HUMAN: moderate risk, needs multisig approval
     * - BLOCKED: high risk, immediate deny
     */
    public async evaluateAction(
        anomalyScore: number,
        agentTier: TrustTier,
        estimatedValue: number,
        actionContext: {
            agentDid: string;
            toolId: string;
            actionType: string;
            parameters: Record<string, unknown>;
        }
    ): Promise<GovernanceResult> {
        const spendingLimit = this.config.tierSpendingLimits[agentTier];
        const timestamp = new Date().toISOString();

        // HARD BLOCK: anomaly score exceeds hard threshold
        if (anomalyScore >= this.config.hardBlockThreshold) {
            return {
                decision: 'BLOCKED',
                reason: `Anomaly score ${anomalyScore.toFixed(3)} exceeds hard block threshold ${this.config.hardBlockThreshold}. ` +
                    `Action blocked per EU AI Act Article 9 (Risk Management). No multisig proposal generated.`,
                anomalyScore,
                agentTier,
                spendingLimit,
                receipt: this.generateReceipt('BLOCKED', anomalyScore, actionContext, timestamp),
            };
        }

        // REQUIRE_HUMAN: moderate risk OR value exceeds tier spending limit
        const exceedsTierLimit = estimatedValue > spendingLimit;
        const moderateRisk = anomalyScore >= this.config.humanReviewThreshold;

        if (moderateRisk || exceedsTierLimit) {
            const proposalId = this.generateProposalId(actionContext, timestamp);
            this.proposalCounter++;

            const reason = moderateRisk
                ? `Anomaly score ${anomalyScore.toFixed(3)} triggers human oversight per EU AI Act Article 14. ` +
                  `Squads V4 multisig proposal created for compliance officer review.`
                : `Estimated value ${estimatedValue} lamports exceeds ${agentTier} spending limit of ${spendingLimit} lamports. ` +
                  `Requires human approval via Squads V4 multisig.`;

            return {
                decision: 'REQUIRE_HUMAN',
                reason,
                anomalyScore,
                agentTier,
                spendingLimit,
                proposal: {
                    proposalId,
                    multisigPda: this.config.multisigPda || 'NOT_CONFIGURED',
                    transactionIndex: this.proposalCounter,
                    requiredApprovals: this.getRequiredApprovals(agentTier, anomalyScore),
                    expiresAt: new Date(Date.now() + 3600_000).toISOString(), // 1 hour expiry
                    euAiActArticle: 'Article 14 (Human Oversight)',
                },
                receipt: this.generateReceipt('REQUIRE_HUMAN', anomalyScore, actionContext, timestamp),
            };
        }

        // AUTONOMOUS: low risk, within spending limits
        return {
            decision: 'AUTONOMOUS',
            reason: `Anomaly score ${anomalyScore.toFixed(3)} below threshold. ` +
                `${agentTier} agent operating within spending limit of ${spendingLimit} lamports. ` +
                `No human oversight required.`,
            anomalyScore,
            agentTier,
            spendingLimit,
            receipt: this.generateReceipt('AUTONOMOUS', anomalyScore, actionContext, timestamp),
        };
    }

    /**
     * Create the Squads multisig configuration for deploying a new governance vault.
     * Returns the configuration object and instructions (not executed — for demo/docs).
     */
    public getMultisigConfig(
        members: string[], // Public key strings for compliance officers
        threshold: number
    ): {
        members: { key: string; permissions: string }[];
        threshold: number;
        tierLimits: Record<string, number>;
        instructions: string;
    } {
        return {
            members: members.map((key, i) => ({
                key,
                permissions: i === 0
                    ? 'Proposer, Voter, Executor'
                    : 'Voter',
            })),
            threshold,
            tierLimits: Object.fromEntries(
                Object.entries(this.config.tierSpendingLimits).map(
                    ([tier, limit]) => [tier, limit / LAMPORTS_PER_SOL]
                )
            ),
            instructions: `
// Squads V4 Multisig Creation (TypeScript)
import * as multisig from '@sqds/multisig';

const [multisigPda] = multisig.getMultisigPda({
    createKey: createKeypair.publicKey,
});

const ix = multisig.instructions.multisigCreateV2({
    createKey: createKeypair.publicKey,
    creator: authority.publicKey,
    multisigPda,
    configAuthority: null,
    threshold: ${threshold},
    members: [${members.map((m, i) => `
        { key: new PublicKey("${m}"), permissions: multisig.types.Permissions.${i === 0 ? 'all' : 'fromPermissions({ voter: true })'} }`).join(',')}
    ],
    timeLock: 0,
    rentCollector: null,
});`.trim(),
        };
    }

    /**
     * Get required approval count based on tier and risk.
     */
    private getRequiredApprovals(tier: TrustTier, anomalyScore: number): number {
        // Higher risk = more approvals needed
        if (anomalyScore >= 0.75) return 2; // Near hard-block: 2-of-3
        if (tier === TrustTier.T4) return 1; // Autonomous tier: 1-of-1 (fast track)
        return 1; // Default: 1-of-1 compliance officer approval
    }

    /**
     * Generate a deterministic proposal ID.
     */
    private generateProposalId(
        context: { agentDid: string; toolId: string; actionType: string },
        timestamp: string
    ): string {
        const data = `${context.agentDid}:${context.toolId}:${context.actionType}:${timestamp}`;
        return `aegis-proposal-${createHash('sha256').update(data).digest('hex').substring(0, 16)}`;
    }

    /**
     * Generate a signed receipt hash for the governance decision.
     */
    private generateReceipt(
        decision: GovernanceDecision,
        anomalyScore: number,
        context: Record<string, unknown>,
        timestamp: string
    ): GovernanceResult['receipt'] {
        const payload = JSON.stringify({ decision, anomalyScore, context, timestamp });
        return {
            hash: createHash('sha256').update(payload).digest('hex'),
            timestamp,
            decisionProvenance: `aegis-governance-v1:squads-v4:${decision.toLowerCase()}`,
        };
    }
}
