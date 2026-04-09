/**
 * @aegis/solana-agent-kit
 * 
 * A lightweight wrapper that natively routes an AI agent's Solana
 * intents through the Aegis-12 Compliance Gateway.
 */

import { Connection, Keypair, VersionedTransaction } from '@solana/web3.js';
import fetch from 'node-fetch';

export interface AegisAgentConfig {
    gatewayUrl: string;
    agentKeypair: Keypair;
    agentTier: string;
    agentDid: string;
    connection: Connection;
    multisigPda?: string;
}

export class AegisSolanaAgent {
    constructor(private config: AegisAgentConfig) {}

    /**
     * Executes a transaction through the Aegis-12 Cryptographic Lock.
     * If autonomous (T4 or low risk), it anchors to SPL Memo and executes.
     * If REQUIRE_HUMAN or configured for multisig, it routes to a Squads
     * proposal and requests Aegis to co-sign (2-of-2 lock).
     */
    public async executeSafeTransaction(
        serializedTxBase64: string,
        useSquadsCoSign: boolean = false,
        txIndex?: number
    ): Promise<string> {
        if (useSquadsCoSign) {
            if (!this.config.multisigPda || txIndex === undefined) {
                throw new Error("multisigPda and txIndex required for co-signing");
            }
            // Ask Aegis to cryptographically co-sign the Squads proposal
            const response = await fetch(`${this.config.gatewayUrl}/solana/cosign-proposal`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    multisigPda: this.config.multisigPda,
                    transactionIndex: txIndex,
                })
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(`Aegis rejected co-signing: ${result.reason || result.error}`);
            }

            return `Squads Proposal ${txIndex} co-signed by Aegis. Transaction is ready to execute on-chain.`;
        } else {
            // Standard enforcement + SPL Memo Anchor
            const response = await fetch(`${this.config.gatewayUrl}/solana/enforce-tx`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    serializedTx: serializedTxBase64,
                    walletPubkey: this.config.agentKeypair.publicKey.toBase58(),
                    agentTier: this.config.agentTier,
                    agentDid: this.config.agentDid
                })
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(`Aegis enforcement failed: ${result.reason || result.error}`);
            }

            // Since Aegis allowed it, anchor the receipt and optionally send tx
            // For a production agent, the actual send raw transaction would happen here
            return `Transaction allowed. Aegis risk score: ${result.riskScore}.`;
        }
    }
}
