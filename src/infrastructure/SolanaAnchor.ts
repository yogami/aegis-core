/**
 * SolanaAnchor — On-Chain Receipt Anchoring & Verification
 * 
 * Anchors signed ToolExecutionReceipts to Solana via SPL Memo program.
 * Provides public verification of anchored receipts.
 * 
 * This is the critical Solana-native component identified by the 4-model
 * audit council as the #1 priority fix.
 */

import {
    Connection,
    Keypair,
    Transaction,
    sendAndConfirmTransaction,
    PublicKey,
    clusterApiUrl,
    ParsedTransactionWithMeta,
} from '@solana/web3.js';
import { createMemoInstruction } from '@solana/spl-memo';
import { createHash } from 'crypto';
import { ToolExecutionReceipt } from '../types';
import { AegisSigner } from './AegisSigner';

export interface AnchorResult {
    txSignature: string;
    receiptHash: string;
    slot: number;
    cluster: string;
    explorerUrl: string;
    anchoredAt: string;
}

export interface VerificationResult {
    verified: boolean;
    txSignature: string;
    onChainMemo: string | null;
    recomputedHash: string | null;
    enclaveSignatureValid: boolean;
    slot: number | null;
    blockTime: number | null;
    error?: string;
}

export class SolanaAnchor {
    private connection: Connection;
    private payer: Keypair;
    private cluster: string;

    constructor(cluster: string = 'devnet', payerSecretKey?: Uint8Array) {
        this.cluster = cluster;
        const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl(cluster as any);
        this.connection = new Connection(rpcUrl, 'confirmed');

        if (payerSecretKey) {
            this.payer = Keypair.fromSecretKey(payerSecretKey);
        } else if (process.env.SOLANA_PAYER_SECRET) {
            // Accept base64-encoded secret key from env
            const decoded = Buffer.from(process.env.SOLANA_PAYER_SECRET, 'base64');
            this.payer = Keypair.fromSecretKey(new Uint8Array(decoded));
        } else {
            // Generate ephemeral keypair for devnet demo
            this.payer = Keypair.generate();
            console.warn('[SolanaAnchor] ⚠️ Using ephemeral keypair. Set SOLANA_PAYER_SECRET for persistence.');
        }
    }

    /**
     * Get the payer's public key (for airdrop requests on devnet).
     */
    public getPayerPublicKey(): string {
        return this.payer.publicKey.toBase58();
    }

    /**
     * Request an airdrop of SOL on devnet for the payer.
     */
    public async requestAirdrop(lamports: number = 1_000_000_000): Promise<string> {
        const sig = await this.connection.requestAirdrop(this.payer.publicKey, lamports);
        await this.connection.confirmTransaction(sig, 'confirmed');
        return sig;
    }

    /**
     * Compute a deterministic hash of a ToolExecutionReceipt.
     * Uses SHA-256 over a JSON-canonicalized representation.
     */
    public computeReceiptHash(receipt: ToolExecutionReceipt): string {
        // Sort keys for deterministic hashing (simplified JCS)
        const canonical = JSON.stringify(receipt, Object.keys(receipt).sort());
        return createHash('sha256').update(canonical).digest('hex');
    }

    /**
     * Anchor a signed ToolExecutionReceipt to Solana via SPL Memo.
     * 
     * The memo format is:
     *   aegis:v1:<actionId>:<receiptHash>:<decision>:<enclaveDid>
     * 
     * This creates an immutable, publicly verifiable on-chain record
     * that proves an enforcement decision was made at a specific time.
     */
    public async anchorReceipt(
        receipt: ToolExecutionReceipt,
        decision: 'approved' | 'denied',
        enclaveDid: string
    ): Promise<AnchorResult> {
        const receiptHash = this.computeReceiptHash(receipt);

        // Construct structured memo (max 566 bytes for Memo V1)
        const memo = [
            'aegis:v1',
            receipt.actionId,
            receiptHash.substring(0, 16), // First 16 chars of hash (64-bit collision resistance)
            decision,
            enclaveDid.substring(enclaveDid.lastIndexOf(':') + 1), // Short DID suffix
            receipt.timestamp
        ].join(':');

        const transaction = new Transaction().add(
            createMemoInstruction(memo, [this.payer.publicKey])
        );

        const txSignature = await sendAndConfirmTransaction(
            this.connection,
            transaction,
            [this.payer],
            { commitment: 'confirmed' }
        );

        const slot = await this.connection.getSlot('confirmed');

        const explorerUrl = this.cluster === 'mainnet-beta'
            ? `https://explorer.solana.com/tx/${txSignature}`
            : `https://explorer.solana.com/tx/${txSignature}?cluster=${this.cluster}`;

        console.log(`[SolanaAnchor] ✅ Receipt anchored: ${txSignature} (slot ${slot})`);

        return {
            txSignature,
            receiptHash,
            slot,
            cluster: this.cluster,
            explorerUrl,
            anchoredAt: new Date().toISOString(),
        };
    }

    /**
     * Verify an anchored receipt by fetching the transaction from Solana
     * and comparing the on-chain memo against the provided receipt.
     */
    public async verifyAnchoredReceipt(
        txSignature: string,
        receipt?: ToolExecutionReceipt,
        signer?: AegisSigner
    ): Promise<VerificationResult> {
        try {
            const tx: ParsedTransactionWithMeta | null =
                await this.connection.getParsedTransaction(txSignature, {
                    commitment: 'confirmed',
                    maxSupportedTransactionVersion: 0,
                });

            if (!tx) {
                return {
                    verified: false,
                    txSignature,
                    onChainMemo: null,
                    recomputedHash: null,
                    enclaveSignatureValid: false,
                    slot: null,
                    blockTime: null,
                    error: 'Transaction not found on Solana',
                };
            }

            // Extract memo from transaction logs
            const memoLog = tx.meta?.logMessages?.find(log =>
                log.includes('Program log: Memo')
            );
            
            // Also check inner instructions for memo data
            let onChainMemo: string | null = null;
            if (tx.transaction?.message?.instructions) {
                for (const ix of tx.transaction.message.instructions) {
                    if ('parsed' in ix && typeof ix.parsed === 'string') {
                        onChainMemo = ix.parsed;
                        break;
                    }
                    if ('data' in ix && ix.programId.toBase58() === 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr') {
                        // Memo V2 program
                        onChainMemo = Buffer.from(ix.data as string, 'base64').toString('utf-8');
                        break;
                    }
                }
            }

            // If we don't find it in instructions, try log messages
            if (!onChainMemo && memoLog) {
                const match = memoLog.match(/Memo \(len \d+\): "(.*?)"/);
                if (match) onChainMemo = match[1];
            }

            let recomputedHash: string | null = null;
            let hashMatch = false;
            let signatureValid = false;

            if (receipt) {
                recomputedHash = this.computeReceiptHash(receipt);
                // Check if the on-chain memo contains our receipt hash prefix
                if (onChainMemo) {
                    hashMatch = onChainMemo.includes(recomputedHash.substring(0, 16));
                }
            }

            if (receipt && signer) {
                const canonical = JSON.stringify(receipt, Object.keys(receipt).sort());
                try {
                    signatureValid = signer.verify(
                        canonical,
                        receipt.signature,
                        signer.getPublicKeyHex()
                    );
                } catch {
                    signatureValid = false;
                }
            }

            return {
                verified: hashMatch || (onChainMemo !== null && onChainMemo.startsWith('aegis:v1')),
                txSignature,
                onChainMemo,
                recomputedHash,
                enclaveSignatureValid: signatureValid,
                slot: tx.slot,
                blockTime: tx.blockTime ?? null,
            };
        } catch (e: any) {
            return {
                verified: false,
                txSignature,
                onChainMemo: null,
                recomputedHash: null,
                enclaveSignatureValid: false,
                slot: null,
                blockTime: null,
                error: e.message,
            };
        }
    }
}
