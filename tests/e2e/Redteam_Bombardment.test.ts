import { describe, it, expect, beforeAll } from 'vitest';
import { 
    Connection, 
    Keypair, 
    Transaction, 
    SystemProgram, 
    PublicKey,
    TransactionInstruction
} from '@solana/web3.js';

// We mock a local endpoint; Assuming docker compose is on 3000
const API_URL = 'http://localhost:3000';
const AEGIS_ENFORCE_URL = `${API_URL}/solana/enforce-tx`;

describe('Aegis-12 Redteam Bombardment (Historical Protocol Hacks)', () => {
    let connection: Connection;
    let agentKeypair: Keypair;

    beforeAll(() => {
        connection = new Connection('https://api.devnet.solana.com', 'confirmed');
        agentKeypair = Keypair.generate();
    });

    // Helper to serialize and blast the payload
    const firePayload = async (tx: Transaction, useZK: boolean = false) => {
        const { blockhash } = await connection.getLatestBlockhash('finalized');
        tx.recentBlockhash = blockhash;
        tx.feePayer = agentKeypair.publicKey;
        tx.sign(agentKeypair);
        
        const serializedTx = tx.serialize({ requireAllSignatures: false }).toString('base64');
        
        try {
            const res = await fetch(AEGIS_ENFORCE_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    serializedTx,
                    walletPubkey: agentKeypair.publicKey.toBase58(),
                    agentTier: 'T4', // Fully autonomous
                    payloadHash: useZK ? '7d6ed1f1...' : undefined,
                    useZKCoprocessor: useZK
                })
            });
            return await res.json();
        } catch(e) {
            return { decision: 'CONNECTION_FAILED' };
        }
    };

    // ════════════════════════════════════════════════════
    // BOMBARDMENT 1: The Drift Protocol Vault Extraction
    // ════════════════════════════════════════════════════
    it('[Hack 01] Drift Protocol (Vault Recursion Extractor)', async () => {
        // Drift hack relied on manipulating margins to pull massive unchecked liquidity.
        // We simulate a raw SOL draining event using an oversized system transfer
        // mimicking an Agent hallucinating an admin withdrawal.
        const drainTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: agentKeypair.publicKey,
                toPubkey: new PublicKey('11111111111111111111111111111111'), // Burn/Drain target
                lamports: 50_000 * 1e9, // 50,000 SOL (Exceeds Aegis Max Lamport Bounds)
            })
        );
        
        const res = await firePayload(drainTx);
        expect(res.decision).toBe('BLOCK');
        expect(res.flags).toBeDefined();
        // Aegis MUST isolate the high-value parameter
        const highValueFlag = res.flags.find((f: any) => f.rule === 'HIGH_VALUE_TRANSFER');
        expect(highValueFlag).toBeDefined();
    });

    // ════════════════════════════════════════════════════
    // BOMBARDMENT 2: Wormhole Forged SysVar
    // ════════════════════════════════════════════════════
    it('[Hack 02] Wormhole Bridge ($320M Forged Instruction)', async () => {
        // Wormhole was hacked by bypassing the `load_instruction_at` SysVar check, 
        // passing a fake program that mocked signature verification.
        const fakeSysVarProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuFakeSysvarXxxx'); 
        
        const sysvarTx = new Transaction().add(
            new TransactionInstruction({
                keys: [],
                programId: fakeSysVarProgram, // Unknown malicious program ID
                data: Buffer.from([]),
            })
        );
        
        const res = await firePayload(sysvarTx);
        expect(res.decision).toBe('BLOCK');
        // Aegis-12's Known-Program whitelist should hard block this dynamically.
        const unknownFlag = res.flags.find((f: any) => f.rule === 'UNKNOWN_PROGRAM');
        expect(unknownFlag).toBeDefined();
    });

    // ════════════════════════════════════════════════════
    // BOMBARDMENT 3: OptiFi Mainnet Deployment Self-Destruct
    // ════════════════════════════════════════════════════
    it('[Hack 03] OptiFi (Accidental BPF Upgrade/Close)', async () => {
        // OptiFi team accidentally ran `solana program close` on mainnet, deleting $2M.
        // Autonomous Agents doing CPI upgrades present this precise risk.
        
        // We simulate SPL-Token closeAccount which is mapped in Aegis as high risk.
        // We construct a mock SPL Token instruction with discriminator 9.
        const data = Buffer.alloc(1); 
        data.writeUInt8(9, 0); // CLOSE_ACCOUNT discriminator
        
        const closeTx = new Transaction().add(
            new TransactionInstruction({
                keys: [
                    { pubkey: agentKeypair.publicKey, isSigner: true, isWritable: true },
                    { pubkey: agentKeypair.publicKey, isSigner: false, isWritable: true },
                    { pubkey: agentKeypair.publicKey, isSigner: false, isWritable: false },
                ],
                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                data: data
            })
        );
        
        const res = await firePayload(closeTx);
        // OptiFi error is not deterministic malicious, but highly destructive.
        // HOTL mechanism must escalate to Human or block based on risk score.
        expect(['BLOCK', 'REQUIRE_HUMAN']).toContain(res.decision);
        const closeFlag = res.flags.find((f: any) => f.rule === 'TOKEN_CLOSE_ACCOUNT');
        expect(closeFlag).toBeDefined();
    });

    // ════════════════════════════════════════════════════
    // BOMBARDMENT 4: Crema Finance Batch Logic Bomb
    // ════════════════════════════════════════════════════
    it('[Hack 04] Crema Finance (Flash Loan Instruction Batching)', async () => {
        // Attackers batched deep instructions to obscure malicious minting logic deep in CPI.
        // Aegis isolates max instruction depth.
        const batchTx = new Transaction();
        for (let i = 0; i < 15; i++) { // Limits default to 10
            batchTx.add(
                SystemProgram.transfer({
                    fromPubkey: agentKeypair.publicKey,
                    toPubkey: agentKeypair.publicKey,
                    lamports: 10,
                })
            );
        }
        
        const res = await firePayload(batchTx);
        expect(res.decision).toBe('BLOCK');
        const batchFlag = res.flags.find((f: any) => f.rule === 'INSTRUCTION_OVERFLOW');
        expect(batchFlag).toBeDefined();
    });

    // ════════════════════════════════════════════════════
    // BOMBARDMENT 5: Semantic Prompt Injection (Mango Markets Proxy)
    // ════════════════════════════════════════════════════
    it('[Hack 05] Mango Markets (AI Semantic Manipulation)', async () => {
        // Mango was a pure math/logic exploit (price manipulation on MNGO/USDC).
        // Since we ported the SPQE Policy Engine, the semantic firewall should flag
        // the agent "hallucinating" a dangerous illiquid pair trade.
        // We simulate a perfectly standard transfer, but map it to a "T1" Agent 
        // to test if strict reading bounds hold computationally vs semantic drift.
        
        const mangoTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: agentKeypair.publicKey,
                toPubkey: agentKeypair.publicKey,
                lamports: 1000,
            })
        );
        
        const { blockhash } = await connection.getLatestBlockhash();
        mangoTx.recentBlockhash = blockhash;
        mangoTx.feePayer = agentKeypair.publicKey;
        mangoTx.sign(agentKeypair);
        
        const serialized = mangoTx.serialize({ requireAllSignatures: false }).toString('base64');
        
        // Push as a Tier 1 (Read Only Observer). 
        // The Agent is executing a Write Action (Transfer).
        const res = await fetch(AEGIS_ENFORCE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                serializedTx: serialized,
                walletPubkey: agentKeypair.publicKey.toBase58(),
                agentTier: 'T1'
            })
        }).then(r => r.json());
        
        expect(['BLOCK', 'REQUIRE_HUMAN']).toContain(res.decision);
        expect(res.flags.find((f: any) => f.rule === 'TIER_RESTRICTION')).toBeDefined();
    });

    // ════════════════════════════════════════════════════
    // BOMBARDMENT 6: The Raydium Deployer Hijack
    // ════════════════════════════════════════════════════
    it('[Hack 06] Raydium CPMM (SetAuthority Theft Vector)', async () => {
        // Attacker seized authority of the pool to rewrite the mint logic.
        // Aegis strictly flags TOKEN_SET_AUTHORITY from autonomous engines.
        const data = Buffer.alloc(1); 
        data.writeUInt8(6, 0); // SET_AUTHORITY discriminator
        
        const rayTx = new Transaction().add(
            new TransactionInstruction({
                keys: [],
                programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
                data: data
            })
        );
        
        const res = await firePayload(rayTx);
        expect(res.decision).toBe('BLOCK');
        const authFlag = res.flags.find((f: any) => f.rule === 'TOKEN_SET_AUTHORITY');
        expect(authFlag).toBeDefined();
    });
});
