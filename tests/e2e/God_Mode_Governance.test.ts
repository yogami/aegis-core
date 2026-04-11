import { describe, it, expect, beforeAll } from 'vitest';
import { 
    Connection, 
    Keypair, 
    Transaction, 
    SystemProgram
} from '@solana/web3.js';
import { withAegis } from '../../src/sdk/index.js';

describe('TDD: God-Mode Governance (PCR0 Allowance Registry)', () => {
    let connection: Connection;
    let agentKeypair: Keypair;

    beforeAll(() => {
        connection = new Connection('https://api.devnet.solana.com', 'confirmed');
        agentKeypair = Keypair.generate();
    });

    it('Should cleanly DESTROY the payload transaction if the remote Enclave returns an unregistered PCR0 Measurement Hash', async () => {
        const rawTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: agentKeypair.publicKey,
                toPubkey: agentKeypair.publicKey,
                lamports: 10,
            })
        );
        rawTx.recentBlockhash = '11111111111111111111111111111111';
        rawTx.feePayer = agentKeypair.publicKey;

        // The exact allowed enclave binary hash established by the DAO Multisig
        const VALID_SQUADS_PCR0_WHITELIST = [
            "c2a6f3b013a52c3c5...genuine_phala_enclave_hash"
        ];

        // Ensure the SDK structurally rejects the transaction wrapper 
        // if the API mock throws a rogue measurement.
        await expect(
            withAegis(rawTx, {
                enclaveUrl: "http://localhost:3000/solana/enforce-tx",
                strictMode: true,
                pcr0Whitelist: VALID_SQUADS_PCR0_WHITELIST
            })
        ).rejects.toThrow(/UNREGISTERED_MEASUREMENT/);
    });
});
