import { describe, it, expect, beforeAll } from 'vitest';
import { 
    Connection, 
    Keypair, 
    Transaction, 
    SystemProgram,
} from '@solana/web3.js';
import { withAegis } from '../../src/sdk/index.js';

describe('TDD: Evidence Anchoring MVP (SPL Memo Injection)', () => {
    let connection: Connection;
    let agentKeypair: Keypair;

    beforeAll(() => {
        connection = new Connection('https://api.devnet.solana.com', 'confirmed');
        agentKeypair = Keypair.generate();
    });

    it('Should append an SPL Memo Instruction containing the ARS Receipt ZK constraint to the payload', async () => {
        // Mock a standard agent transaction (e.g. trading or treasury management)
        const rawTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: agentKeypair.publicKey,
                toPubkey: agentKeypair.publicKey,
                lamports: 10,
            })
        );
        rawTx.recentBlockhash = '11111111111111111111111111111111';
        rawTx.feePayer = agentKeypair.publicKey;

        // Ensure the original rawTx only has 1 instruction
        expect(rawTx.instructions.length).toBe(1);

        // Run through the SDK wrapper
        const { safeTx, receipt } = await withAegis(rawTx, {
            // Pointing to local mock logic so we don't need network latency for unit testing
            enclaveUrl: "http://localhost:3000/solana/enforce-tx"
        });

        // The SDK should gracefully return the raw transaction PLUS a new instruction (the Memo)
        expect(safeTx.instructions.length).toBe(2);

        // Verify the injected memo contains the 'Aegis ARS' semantic payload
        const injectedInstruction = safeTx.instructions[1];
        const injectedMemoText = injectedInstruction.data.toString();
        
        expect(injectedMemoText).toContain('Aegis ARS:');
        expect(injectedMemoText).toContain(receipt.arsToken);
    });
});
