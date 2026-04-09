/**
 * SolanaTransactionFirewall — Pre-Signing Transaction Inspection
 * 
 * Inspects serialized Solana transactions BEFORE signing/broadcast.
 * Enforces policy rules on instruction-level patterns:
 *   - High-value transfer blocking
 *   - Unknown program ID rejection
 *   - SPL Token approve/setAuthority/closeAccount flagging
 *   - Compute budget anomaly detection
 *   - Agent tier-based restrictions
 * 
 * This makes Aegis-12 unambiguously Solana-native — not a generic proxy.
 */

import {
    Transaction,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    LAMPORTS_PER_SOL,
    Connection,
} from '@solana/web3.js';
import { ToolExecutionReceipt } from '../types';
import { AegisSigner } from './AegisSigner';
import { createHash } from 'crypto';

// Well-known Solana program IDs
const KNOWN_PROGRAMS: Record<string, string> = {
    '11111111111111111111111111111111': 'System Program',
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA': 'SPL Token',
    'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb': 'SPL Token 2022',
    'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL': 'Associated Token Account',
    'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr': 'Memo V2',
    'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo': 'Memo V1',
    'ComputeBudget111111111111111111111111111111': 'Compute Budget',
    'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4': 'Jupiter V6',
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc': 'Orca Whirlpool',
    'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK': 'Raydium CPMM',
    'srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX': 'Serum/OpenBook',
    'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s': 'Metaplex Token Metadata',
    'vau1zxA2LbssAUEF7Gpw91zMM1LvXrvpzJtmZ58rPsn': 'Vault Program',
    'SW1TCH7qEPTdLsDHRgPuMQjbQxKdH2aBStViMFnt64f': 'Switchboard',
};

// SPL Token instruction discriminators (first byte)
const TOKEN_IX = {
    TRANSFER: 3,
    APPROVE: 4,
    REVOKE: 5,
    SET_AUTHORITY: 6,
    CLOSE_ACCOUNT: 9,
    TRANSFER_CHECKED: 12,
    APPROVE_CHECKED: 13,
};

export type FirewallDecision = 'ALLOW' | 'BLOCK' | 'REQUIRE_HUMAN';

export interface FirewallResult {
    decision: FirewallDecision;
    reason: string;
    riskScore: number;          // 0.0 - 1.0
    flags: FirewallFlag[];
    receipt?: ToolExecutionReceipt;
    euAiActArticles: string[];
    mitreTechniques: string[];
}

export interface FirewallFlag {
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    rule: string;
    detail: string;
}

export interface FirewallConfig {
    maxTransferLamports: number;        // Max SOL transfer (in lamports)
    maxTokenAmount: number;             // Max SPL token amount
    allowedPrograms: string[];          // Allowlist of program IDs (base58)
    blockUnknownPrograms: boolean;
    maxInstructions: number;            // Max instructions per tx
    maxComputeUnits: number;            // Max compute budget
    requireHumanAboveRisk: number;      // Risk score threshold for human approval
    agentTier: string;                  // T1-T4
}

const DEFAULT_CONFIG: FirewallConfig = {
    maxTransferLamports: 5 * LAMPORTS_PER_SOL,  // 5 SOL
    maxTokenAmount: 1_000_000,                    // 1M token units
    allowedPrograms: Object.keys(KNOWN_PROGRAMS),
    blockUnknownPrograms: true,
    maxInstructions: 10,
    maxComputeUnits: 400_000,
    requireHumanAboveRisk: 0.7,
    agentTier: 'T2',
};

export class SolanaTransactionFirewall {
    private config: FirewallConfig;
    private signer: AegisSigner;
    private connections: Connection[];

    constructor(
        signer: AegisSigner, 
        connections: Connection[], 
        config?: Partial<FirewallConfig>
    ) {
        this.signer = signer;
        this.connections = connections;
        if (!this.connections || this.connections.length === 0) {
            throw new Error("At least one RPC connection is required");
        }
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Inspect a serialized Solana transaction and enforce policy rules.
     */
    public async inspectTransaction(
        serializedTx: string,       // Base64-encoded serialized transaction
        walletPubkey: string,       // Agent's wallet public key
        context?: { sessionId?: string; actionsThisSession?: number }
    ): Promise<FirewallResult> {
        const flags: FirewallFlag[] = [];
        let riskScore = 0;
        const euArticles: string[] = [];
        const mitreTechniques: string[] = [];

        try {
            // Deserialize the transaction
            const txBuffer = Buffer.from(serializedTx, 'base64');
            const tx = Transaction.from(txBuffer);
            const instructions = tx.instructions;

            // Rule 1: Instruction count limit
            if (instructions.length > this.config.maxInstructions) {
                flags.push({
                    severity: 'HIGH',
                    rule: 'INSTRUCTION_OVERFLOW',
                    detail: `Transaction has ${instructions.length} instructions (limit: ${this.config.maxInstructions}). Possible batch attack.`
                });
                riskScore += 0.3;
                euArticles.push('Article 9 (Risk Management)');
                mitreTechniques.push('T1059 (Command Scripting)');
            }

            // Analyze each instruction
            for (let i = 0; i < instructions.length; i++) {
                const ix = instructions[i];
                const programId = ix.programId.toBase58();

                // Rule 2: Unknown program ID
                if (this.config.blockUnknownPrograms && !this.config.allowedPrograms.includes(programId)) {
                    flags.push({
                        severity: 'CRITICAL',
                        rule: 'UNKNOWN_PROGRAM',
                        detail: `Instruction ${i} calls unknown program ${programId}. Possible malicious contract interaction.`
                    });
                    riskScore += 0.5;
                    euArticles.push('Article 15 (Accuracy, Robustness, Cybersecurity)');
                    mitreTechniques.push('T1203 (Exploitation for Client Execution)');
                }

                // Rule 3: System Program — SOL transfers
                if (programId === SystemProgram.programId.toBase58()) {
                    const transferAmount = this.parseSystemTransfer(ix);
                    if (transferAmount !== null && transferAmount > this.config.maxTransferLamports) {
                        flags.push({
                            severity: 'CRITICAL',
                            rule: 'HIGH_VALUE_TRANSFER',
                            detail: `SOL transfer of ${transferAmount / LAMPORTS_PER_SOL} SOL exceeds limit of ${this.config.maxTransferLamports / LAMPORTS_PER_SOL} SOL.`
                        });
                        riskScore += 0.4;
                        euArticles.push('Article 14 (Human Oversight)');
                        mitreTechniques.push('T1537 (Transfer Data to Cloud Account)');
                    }
                }

                // Rule 4: SPL Token dangerous operations
                if (programId === 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' ||
                    programId === 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb') {
                    this.analyzeSplTokenInstruction(ix, i, flags, euArticles, mitreTechniques);
                    if (flags.some(f => f.severity === 'CRITICAL')) {
                        riskScore += 0.3;
                    }
                }

                // Rule 5: Compute Budget anomalies
                if (programId === 'ComputeBudget111111111111111111111111111111') {
                    const units = this.parseComputeBudget(ix);
                    if (units !== null && units > this.config.maxComputeUnits) {
                        flags.push({
                            severity: 'MEDIUM',
                            rule: 'HIGH_COMPUTE_BUDGET',
                            detail: `Compute budget set to ${units} units (limit: ${this.config.maxComputeUnits}). Possible resource exhaustion.`
                        });
                        riskScore += 0.1;
                    }
                }
            }

            // Rule 6: Tier-based restrictions
            if (this.config.agentTier === 'T1') {
                // T1 agents: read-only, no transfers at all
                const hasWrite = instructions.some(ix =>
                    ix.programId.toBase58() !== 'ComputeBudget111111111111111111111111111111' &&
                    ix.programId.toBase58() !== 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'
                );
                if (hasWrite) {
                    flags.push({
                        severity: 'HIGH',
                        rule: 'TIER_RESTRICTION',
                        detail: 'T1 agents are restricted to read-only operations. Transaction contains write instructions.'
                    });
                    riskScore += 0.4;
                    euArticles.push('Article 14 (Human Oversight)');
                }
            }

            // Clamp risk score
            riskScore = Math.min(riskScore, 1.0);

            // SIMULATION: Pre-Flight BFT RPC Consensus
            try {
                // Execute simulateTransaction concurrently with 400ms timeout
                const BFT_TIMEOUT_MS = 400;
                
                const simPromises = this.connections.map(conn => {
                    return Promise.race([
                        conn.simulateTransaction(tx),
                        new Promise<never>((_, reject) => 
                            setTimeout(() => reject(new Error('RPC Timeout')), BFT_TIMEOUT_MS)
                        )
                    ]);
                });

                const settledResults = await Promise.allSettled(simPromises);
                
                const validSimulations = settledResults.filter(
                    (res): res is PromiseFulfilledResult<any> => res.status === 'fulfilled' && !res.value.value.err
                );
                
                const errSimulations = settledResults.filter(
                    (res): res is PromiseFulfilledResult<any> => res.status === 'fulfilled' && !!res.value.value.err
                );

                const totalNodes = this.connections.length;
                const requiredQuorum = Math.floor(totalNodes / 2) + 1;

                // Hash logs to detect splits
                const logHashes = new Map<string, number>();
                let consensusLogs: string[] = [];
                let maxLogVoters = 0;

                for (const sim of validSimulations) {
                    const simLogs = sim.value.value.logs || [];
                    const hashStr = simLogs.join('');
                    const currentVotes = (logHashes.get(hashStr) || 0) + 1;
                    logHashes.set(hashStr, currentVotes);

                    if (currentVotes > maxLogVoters) {
                        maxLogVoters = currentVotes;
                        consensusLogs = simLogs;
                    }
                }

                // If BFT Quorum fails (too many timeouts, or divided logs)
                if (maxLogVoters < requiredQuorum) {
                    // Fail closed if we cannot reach a supermajority on safety
                    flags.push({
                        severity: 'CRITICAL',
                        rule: 'RPC_QUORUM_FAILURE',
                        detail: `Failed to achieve BFT consensus among RPC nodes. Maximum matching state: ${maxLogVoters}/${totalNodes}. Failing closed to prevent eclipse attack.`
                    });
                    riskScore = 1.0;
                    euArticles.push('Article 15 (Accuracy, Robustness, Cybersecurity)');
                    mitreTechniques.push('T1565 (Data Manipulation: Stored Data Manipulation)');
                    
                    // Fallback logs to empty to trigger hard block processing later
                    consensusLogs = [];
                }
                
                if (errSimulations.length >= requiredQuorum) {
                    flags.push({
                        severity: 'HIGH',
                        rule: 'SIMULATION_ERROR',
                        detail: `Transaction simulation failed quorum: ${JSON.stringify(errSimulations[0].value.value.err)}`
                    });
                    riskScore += 0.3;
                    euArticles.push('Article 15 (Accuracy, Robustness, Cybersecurity)');
                }

                // Parse logs from the CONCENSUS state to find ALL executed programs (including CPIs)
                const logs = consensusLogs;
                const executedPrograms = new Set<string>();
                
                const programInvokeRegex = /Program (\w+) invoke/g;
                for (const logLine of logs) {
                    let match;
                    while ((match = programInvokeRegex.exec(logLine)) !== null) {
                        executedPrograms.add(match[1]);
                    }
                }

                if (this.config.blockUnknownPrograms) {
                    for (const pid of executedPrograms) {
                        if (!this.config.allowedPrograms.includes(pid)) {
                            flags.push({
                                severity: 'CRITICAL',
                                rule: 'HIDDEN_CPI_UNKNOWN_PROGRAM',
                                detail: `Simulation revealed hidden CPI to unknown program ${pid}. Critical supply chain risk.`
                            });
                            riskScore = 1.0; // Instant hard block
                            euArticles.push('Article 15 (Accuracy, Robustness, Cybersecurity)');
                            mitreTechniques.push('T1203 (Exploitation for Client Execution)');
                        }
                    }
                }
            } catch (simError: any) {
                // We don't hard block on network failure of simulation, but we flag it
                flags.push({
                    severity: 'MEDIUM',
                    rule: 'SIMULATION_UNAVAILABLE',
                    detail: `Could not reach RPC for pre-flight simulation: ${simError.message}`
                });
            }

            // Clamp risk score again just in case simulation spiked it
            riskScore = Math.min(riskScore, 1.0);

            // Determine decision
            let decision: FirewallDecision;
            if (flags.some(f => f.severity === 'CRITICAL')) {
                decision = 'BLOCK';
            } else if (riskScore >= this.config.requireHumanAboveRisk) {
                decision = 'REQUIRE_HUMAN';
            } else {
                decision = 'ALLOW';
            }

            // Generate signed receipt
            const receiptData = {
                actionId: `solana-tx-${Date.now()}`,
                toolId: 'solana-transaction-firewall',
                authorizationNonce: `nonce-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
                parameters: {
                    wallet: walletPubkey,
                    instructionCount: instructions.length,
                    programs: [...new Set(instructions.map(ix => ix.programId.toBase58()))],
                    decision,
                    riskScore,
                    flagCount: flags.length,
                },
                resultHash: createHash('sha256')
                    .update(JSON.stringify({ decision, flags, riskScore }))
                    .digest('hex'),
                timestamp: new Date().toISOString(),
                signature: '',
            };

            const canonical = JSON.stringify(receiptData, Object.keys(receiptData).sort());
            receiptData.signature = this.signer.sign(canonical);

            return {
                decision,
                reason: decision === 'ALLOW'
                    ? 'Transaction passed all firewall rules.'
                    : decision === 'REQUIRE_HUMAN'
                        ? `Risk score ${riskScore.toFixed(2)} exceeds threshold. Human approval required.`
                        : `Transaction blocked: ${flags.filter(f => f.severity === 'CRITICAL').map(f => f.rule).join(', ')}`,
                riskScore,
                flags,
                receipt: receiptData,
                euAiActArticles: [...new Set(euArticles)],
                mitreTechniques: [...new Set(mitreTechniques)],
                executedPrograms: Array.from(executedPrograms),
            };
        } catch (e: any) {
            return {
                decision: 'BLOCK',
                reason: `Transaction parsing failed: ${e.message}`,
                riskScore: 1.0,
                flags: [{
                    severity: 'CRITICAL',
                    rule: 'PARSE_FAILURE',
                    detail: `Could not deserialize transaction: ${e.message}`
                }],
                euAiActArticles: ['Article 15 (Accuracy, Robustness, Cybersecurity)'],
                mitreTechniques: ['T1027 (Obfuscated Files or Information)'],
                executedPrograms: [],
            };
        }
    }

    /**
     * Parse System Program transfer instruction to extract lamport amount.
     */
    private parseSystemTransfer(ix: TransactionInstruction): number | null {
        // System Program Transfer instruction: discriminator 2, then u64 lamports
        if (ix.data.length >= 12 && ix.data.readUInt32LE(0) === 2) {
            // Read lamports as u64 (little-endian)
            const low = ix.data.readUInt32LE(4);
            const high = ix.data.readUInt32LE(8);
            return low + high * 2 ** 32;
        }
        return null;
    }

    /**
     * Analyze SPL Token instruction for dangerous operations.
     */
    private analyzeSplTokenInstruction(
        ix: TransactionInstruction,
        index: number,
        flags: FirewallFlag[],
        euArticles: string[],
        mitreTechniques: string[]
    ): void {
        if (ix.data.length === 0) return;
        const discriminator = ix.data[0];

        switch (discriminator) {
            case TOKEN_IX.APPROVE:
            case TOKEN_IX.APPROVE_CHECKED:
                flags.push({
                    severity: 'HIGH',
                    rule: 'TOKEN_APPROVE',
                    detail: `Instruction ${index}: SPL Token Approve detected. This grants a delegate spending authority. Potential asset drain risk.`
                });
                euArticles.push('Article 14 (Human Oversight)');
                mitreTechniques.push('T1528 (Steal Application Access Token)');
                break;

            case TOKEN_IX.SET_AUTHORITY:
                flags.push({
                    severity: 'CRITICAL',
                    rule: 'TOKEN_SET_AUTHORITY',
                    detail: `Instruction ${index}: SPL Token SetAuthority detected. This changes token account ownership. CRITICAL theft vector.`
                });
                euArticles.push('Article 9 (Risk Management)');
                mitreTechniques.push('T1098 (Account Manipulation)');
                break;

            case TOKEN_IX.CLOSE_ACCOUNT:
                flags.push({
                    severity: 'HIGH',
                    rule: 'TOKEN_CLOSE_ACCOUNT',
                    detail: `Instruction ${index}: SPL Token CloseAccount detected. This drains remaining tokens and rent.`
                });
                euArticles.push('Article 15 (Accuracy, Robustness, Cybersecurity)');
                mitreTechniques.push('T1485 (Data Destruction)');
                break;

            case TOKEN_IX.TRANSFER:
            case TOKEN_IX.TRANSFER_CHECKED: {
                // Check transfer amount (bytes 1-8 for Transfer, 1-8 for TransferChecked)
                if (ix.data.length >= 9) {
                    const low = ix.data.readUInt32LE(1);
                    const high = ix.data.readUInt32LE(5);
                    const amount = low + high * 2 ** 32;
                    if (amount > this.config.maxTokenAmount) {
                        flags.push({
                            severity: 'HIGH',
                            rule: 'HIGH_TOKEN_TRANSFER',
                            detail: `Instruction ${index}: Token transfer of ${amount} units exceeds limit of ${this.config.maxTokenAmount}.`
                        });
                        euArticles.push('Article 14 (Human Oversight)');
                        mitreTechniques.push('T1537 (Transfer Data to Cloud Account)');
                    }
                }
                break;
            }
        }
    }

    /**
     * Parse Compute Budget instruction for compute unit limit.
     */
    private parseComputeBudget(ix: TransactionInstruction): number | null {
        // SetComputeUnitLimit: discriminator 2, then u32 units
        if (ix.data.length >= 5 && ix.data[0] === 2) {
            return ix.data.readUInt32LE(1);
        }
        return null;
    }
}
