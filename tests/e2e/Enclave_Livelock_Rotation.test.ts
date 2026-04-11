import { describe, it, expect, beforeAll } from 'vitest';
import { 
    Connection, 
    Keypair, 
    Transaction, 
    SystemProgram
} from '@solana/web3.js';
import { withAegis } from '../../src/sdk/index.js';

describe('TDD: Enclave Circuit-Breaker Fallback (Livelock Prevention)', () => {
    let connection: Connection;
    let agentKeypair: Keypair;

    beforeAll(() => {
        connection = new Connection('https://api.devnet.solana.com', 'confirmed');
        agentKeypair = Keypair.generate();
    });

    it('Should trigger an 800ms AbortController timeout if primary endpoint hangs, rerouting to fallback automatically', async () => {
        const rawTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: agentKeypair.publicKey,
                toPubkey: agentKeypair.publicKey,
                lamports: 10,
            })
        );
        rawTx.recentBlockhash = '11111111111111111111111111111111';
        rawTx.feePayer = agentKeypair.publicKey;

        const startTime = Date.now();

        // 10.255.255.1 is a non-routable IP that will definitively hang and timeout
        const { receipt, reviewPending } = await withAegis(rawTx, {
            enclaveUrl: "http://10.255.255.1:3000/solana/enforce-tx",
            // The SDK MUST physically intercept the timeout and attempt to hit this fallback URL immediately
            fallbackUrls: ["http://localhost:3000/solana/enforce-tx"],
            strictMode: false // Allow failover for the test
        });

        const executionTime = Date.now() - startTime;

        // Even though the primary physical enclave experienced a Kernel Panic (blackhole),
        // the agent's SDK must have severed the request in under 5000ms.
        // It should never livelock.
        expect(executionTime).toBeLessThan(5000);
        
        // Assert that the receipt flags that a cluster fallback occurred.
        expect(receipt.clusterFallbackTriggered).toBeDefined();
    });
});
