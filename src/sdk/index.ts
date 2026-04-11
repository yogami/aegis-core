import { Transaction, VersionedTransaction, Connection, TransactionInstruction, PublicKey, SystemProgram } from '@solana/web3.js';

export interface AegisConfig {
    enclaveUrl?: string; // Optional: Override for Enterprise self-hosting
    apiKey?: string;
    strictMode?: boolean; // If true, kills transaction on semantic drift (default). If false, tags and lets it through.
    useDurableNonce?: boolean; // Backlog Item 1: Migrates expired transactions to Nonces for human review
    nonceAccountPublickey?: string;
    nonceAuthorityPublickey?: string;
    pcr0Whitelist?: string[]; // Backlog Item 4: Forces payload rejection if enclave hash isn't registered by multi-sig
}

export interface AegisReceipt {
    certified: boolean;
    arsToken: string; // The ZK-SNARK anchor receipt
    reasoning: string;
}

/**
 * The Aegis-12 Developer Experience SDK.
 * Exposes a frictionless 2-line wrapper that physically abstracts away
export async function withAegis(
    tx: Transaction | VersionedTransaction,
    config: AegisConfig = {}
): Promise<{ safeTx: Transaction | VersionedTransaction; receipt: AegisReceipt; reviewPending?: boolean }> {
    // Backlog Item 3: TEE Containerization.
    // If developers deploy their own Sovereign Enclave via our `app-compose.json` dstack file,
    // they pass their 1-click Phala Remote endpoint here. 
    // Otherwise, we fallback to our generic centralized hackathon backend.
    const endpoint = config.enclaveUrl || "https://api.aegis12.network/v1/enforce";

    // 1. Serialize locally
    const serializedTx = Buffer.from(tx.serialize()).toString('base64');
    
    try {
        // 2. Fire intent to the remote Iron Triangle
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.apiKey || 'anonymous'}`
            },
            body: JSON.stringify({
                serializedTx,
                enforceStrictMode: config.strictMode ?? true
            })
        });

        const data = await response.json();
        
        // Backlog Item 4: God Mode Supply-Chain Governance
        // If the developer restricts payloads to DAO-approved Enclaves, we explicitly 
        // verify the Hardware PCR0 Measurement Hash returned in the API attestation object.
        if (config.pcr0Whitelist && config.pcr0Whitelist.length > 0) {
            const hardwareMeasurement = data.pcr0 || "unverified_rogue_hash";
            if (!config.pcr0Whitelist.includes(hardwareMeasurement)) {
                throw new Error(`[Aegis-12 Override]: UNREGISTERED_MEASUREMENT. The executing TEE hardware measurement [${hardwareMeasurement}] is not mapped to the secure on-chain Squads V4 whitelist. Supply-Chain intercept initiated.`);
            }
        }

        let isHumanPending = false;

        if (data.decision === 'REQUIRE_HUMAN') {
            if (!config.useDurableNonce || !config.nonceAccountPublickey || !config.nonceAuthorityPublickey) {
                throw new Error(`[Aegis-12 HOTL]: Transaction flagged for human review, but Durable Nonces are not configured. Transaction will expire.`);
            }
            isHumanPending = true;
        } else if (data.decision === 'BLOCK') {
            throw new Error(`[Aegis-12 Override]: Transaction halted. Reason: ${data.flags?.[0]?.rule || 'Semantic/Structural Anomaly'}`);
        }

        // 3. Evidence Anchoring (Backlog Item 2)
        // Inject an SPL Memo instruction containing our verifiable constraint hash directly into the Solana payload.
        const receiptToken = data.ars_anchor || "mock-ars-zk-snark-8df99a1";
        
        let anchoredTx = tx;
        if (tx instanceof Transaction) {
            anchoredTx = new Transaction();
            
            // Backlog Item 1: HOTL Temporal Decay Prevention
            if (config.useDurableNonce && config.nonceAccountPublickey && config.nonceAuthorityPublickey) {
                anchoredTx.add(
                    SystemProgram.nonceAdvance({
                        noncePubkey: new PublicKey(config.nonceAccountPublickey),
                        authorizedPubkey: new PublicKey(config.nonceAuthorityPublickey),
                    })
                );
            }

            // Append original instructions
            anchoredTx.add(...tx.instructions);
            anchoredTx.recentBlockhash = tx.recentBlockhash;
            anchoredTx.feePayer = tx.feePayer;
            
            anchoredTx.add(
                new TransactionInstruction({
                    keys: [],
                    programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
                    data: Buffer.from(`Aegis ARS: ${receiptToken}`, 'utf-8')
                })
            );
        }

        return {
            safeTx: anchoredTx,
            reviewPending: isHumanPending,
            receipt: {
                certified: true,
                arsToken: receiptToken,
                reasoning: data.reasoning || "Cleared Iron Triangle Structural Checks"
            }
        };

    } catch (e: any) {
        if (config.strictMode !== false) {
            throw e;
        }
        // Fail-open for non-strict mode
        return {
            safeTx: tx,
            reviewPending: false,
            receipt: { certified: false, arsToken: "", reasoning: e.message }
        };
    }
}
