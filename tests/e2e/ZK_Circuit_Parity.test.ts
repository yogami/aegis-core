import { describe, it, expect, beforeAll } from 'vitest';
import { 
    Connection, 
    Keypair, 
    Transaction, 
    SystemProgram
} from '@solana/web3.js';
import { withAegis } from '../../src/sdk/index.js';

describe('TDD: Zero-Knowledge Circuit Verification Parity', () => {
    let connection: Connection;
    let agentKeypair: Keypair;

    beforeAll(() => {
        connection = new Connection('https://api.devnet.solana.com', 'confirmed');
        agentKeypair = Keypair.generate();
    });

    it('Should block the payload if the Enclave attempts to use a deprecated, vulnerable, or unauthorized ZK Circuit Hash', async () => {
        const rawTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: agentKeypair.publicKey,
                toPubkey: agentKeypair.publicKey,
                lamports: 10,
            })
        );
        rawTx.recentBlockhash = '11111111111111111111111111111111';
        rawTx.feePayer = agentKeypair.publicKey;

        // The secure mathematically audited SP1 vkey we trust:
        const SAFE_VKEY = "vkey_cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e";

        // Mocks an interaction where the remote enclave returns data handled by an outdated or backdoored circuit
        await expect(
            withAegis(rawTx, {
                enclaveUrl: "http://localhost:3000/solana/enforce-tx",
                strictMode: true,
                expectedZkVkey: SAFE_VKEY
            })
        ).rejects.toThrow(/VULNERABLE_ZK_CIRCUIT/);
    });
});
