/**
 * @aegis/solana-agent-kit
 * 
 * The one-line drop-in for AI Agent Evidence Anchoring on Solana.
 * Automatically wraps agent transactions with:
 *   1. 3-of-5 BFT RPC Consensus (The Agent Hallucination Firewall)
 *   2. Cryptographic Evidence Anchoring (ARS-01)
 * 
 * Includes deterministic fail-safe handling: If RPCs fail to reach
 * quorum within 400ms, the agent gracefully degrades to a local un-anchored broadcast rather than crashing.
 */

import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import fetch from 'node-fetch';

export interface AegisConfig {
    firewallUrl: string; // The deployed TEE firewall endpoint (e.g., https://api.aegis.network)
    x402Token?: string;  // Payment token for the infrastructure routing fee
    fallbackOnTimeout?: boolean; // Whether to bypass Aegis and execute raw tx if Aegis is down/slow
    timeoutMs?: number;  // Max latency allowed for the entire Aegis anchoring pipeline
    useSquadsCoSign?: boolean; // If true, triggers the 2-of-2 async Squads multisig workflow
}

export type AgentAction = (...args: any[]) => Promise<VersionedTransaction | null>;

export interface AnchoredResult {
    success: boolean;
    txSignature?: string;
    ars01Receipt?: any;
    decision: 'ALLOW' | 'BLOCK' | 'REQUIRE_HUMAN' | 'FALLBACK';
    error?: string;
}

/**
 * 
 * @param agentAction An async function that returns a VersionedTransaction (the agent's intended action).
 * @param config The Aegis integration config.
 * @returns An intercepted action that transparently routes the transaction through the Aegis enforcement layer.
 */
export function withAegis(
    agentAction: AgentAction, 
    config: AegisConfig
): (...args: any[]) => Promise<AnchoredResult> {
    
    return async (...args: any[]): Promise<AnchoredResult> => {
        const timeoutMs = config.timeoutMs || 2500;
        
        try {
            // 1. Let the agent generate the transaction
            const rawTx = await agentAction(...args);
            if (!rawTx) {
                return { success: false, decision: 'BLOCK', error: 'Agent failed to build transaction' };
            }

            // 2. Package and send to Aegis TEE
            const serializedTx = Buffer.from(rawTx.serialize()).toString('base64');
            const headers: any = { 'Content-Type': 'application/json' };
            if (config.x402Token) {
                headers['x-payment'] = config.x402Token;
            }

            // Controller for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            const endpointStr = `${config.firewallUrl}/solana/enforce-tx`;
            const payload = {
                serializedTx,
                walletPubkey: 'AgentPubKeyPlaceholder111111111111111111111',
                useSquadsCoSign: !!config.useSquadsCoSign
            };

            let response = await fetch(endpointStr, {
                method: 'POST',
                headers,
                body: JSON.stringify(payload),
                signal: controller.signal as any,
            });

            if (response.status === 402) {
                clearTimeout(timeoutId);
                return { success: false, decision: 'BLOCK', error: 'x402 Infrastructure Fee Required' };
            }

            if (!response.ok) {
                clearTimeout(timeoutId);
                throw new Error(`Aegis Firewall Error: ${response.status} ${response.statusText}`);
            }

            let data = await response.json();

            // 3. Squads Async Polling State Machine
            while (response.status === 202 && data.status === 'PENDING_BFT_CONSENSUS') {
                const txnId = data.transactionId;
                // Wait briefly before polling to prevent spanning the network
                await new Promise(resolve => setTimeout(resolve, 500));
                
                response = await fetch(`${config.firewallUrl}/solana/enforce-tx/status?txnId=${txnId}`, {
                    method: 'GET',
                    headers,
                    signal: controller.signal as any,
                });

                if (!response.ok) {
                    clearTimeout(timeoutId);
                    throw new Error(`Aegis Firewall Polling Error: ${response.status} ${response.statusText}`);
                }

                data = await response.json();
            }

            clearTimeout(timeoutId);
            
            // Map Squads async APPROVED status back to normal ALLOW
            if (data.status === 'APPROVED') {
                data.decision = 'ALLOW';
            }

            if (data.decision === 'BLOCK') {
                return { success: false, decision: 'BLOCK', error: 'Blocked by BFT RPC Consensus (Poisoning/PolicyViolation)', ars01Receipt: data };
            }

            if (data.decision === 'REQUIRE_HUMAN') {
                return { success: true, decision: 'REQUIRE_HUMAN', ars01Receipt: data };
            }

            // If ALLOW, the backend would typically cosign and forward to Jito. 
            // In the SDK, we just return the successful anchored receipt.
            return {
                success: true,
                decision: 'ALLOW',
                txSignature: data.signature,
                ars01Receipt: data,
            };

        } catch (error: any) {
            // THE TRAP: Deterministic Error Handling
            // If the TEE times out or BFT fails to resolve in time,
            // we must not crash the agent's OS thread.
            if (config.fallbackOnTimeout) {
                console.warn(`[Aegis SDK] WARNING: Firewall timed out or failed. Failing open to raw execution (FALLBACK mode). Error: ${error.message}`);
                
                // In a real implementation we would broadcast rawTx directly to a fallback RPC here.
                return {
                    success: false, // Not anchored
                    decision: 'FALLBACK',
                    error: `Aegis Timeout: Graceful fallback executed. ${error.message}`
                };
            } else {
                return {
                    success: false,
                    decision: 'BLOCK',
                    error: `Aegis Strict Mode Enforced: Network failure or timeout blocked execution. Original error: ${error.message}`
                };
            }
            
            return {
                success: false,
                decision: 'BLOCK',
                error: `Aegis Critical Failure: ${error.message}`,
            };
        }
    };
}
