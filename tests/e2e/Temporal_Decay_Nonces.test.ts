import { describe, it, expect, beforeAll } from 'vitest';
import { 
    Connection, 
    Keypair, 
    Transaction, 
    SystemProgram,
    PublicKey
} from '@solana/web3.js';
import { withAegis } from '../../src/sdk/index.js';

describe('TDD: Temporal Decay Nonces (Backlog Item 1)', () => {
    let connection: Connection;
    let agentKeypair: Keypair;
    let mockNonceAccount: Keypair;

    beforeAll(() => {
        connection = new Connection('https://api.devnet.solana.com', 'confirmed');
        agentKeypair = Keypair.generate();
        mockNonceAccount = Keypair.generate(); // Represents an active nonce account
    });

    it('Should intercept the raw transaction and inject a Durable Nonce structure to bypass blockhash decay', async () => {
        // Mock a standard agent transaction that normally expires in 60 seconds
        const rawTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: agentKeypair.publicKey,
                toPubkey: agentKeypair.publicKey,
                lamports: 10,
            })
        );
        rawTx.recentBlockhash = '11111111111111111111111111111111';
        rawTx.feePayer = agentKeypair.publicKey;

        expect(rawTx.instructions.length).toBe(1);

        // Run through the SDK wrapper with Nonce config
        const { safeTx, receipt, reviewPending } = await withAegis(rawTx, {
            enclaveUrl: "http://localhost:3000/solana/enforce-tx",
            useDurableNonce: true,
            nonceAccountPublickey: mockNonceAccount.publicKey.toBase58(),
            nonceAuthorityPublickey: agentKeypair.publicKey.toBase58()
        });

        // The exact architecture dictates the Nonce Advance MUST be the absolute first instruction
        const firstInstruction = safeTx.instructions[0];
        
        // SystemProgram's nonceAdvance actually references standard System constraints
        expect(firstInstruction.programId.toBase58()).toBe(SystemProgram.programId.toBase58());
        
        // Check that the keys match our nonce configs
        expect(firstInstruction.keys[0].pubkey.toBase58()).toBe(mockNonceAccount.publicKey.toBase58());
        
        // Ensure the SDK appropriately flags it for the developer's DB
        expect(reviewPending).toBeDefined();
    });
});
