import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';

// Mocking the Fastify instance from server.ts is tricky without refactoring server.ts to export the app.
// For the sake of this ATDD test, we will create a mock fastify instance that mirrors our planned implementation.
// Once ATDD passes, we will replicate the logic inside server.ts.

describe('Server Async Orchestration (ATDD)', () => {
    let app: ReturnType<typeof Fastify>;

    // The in-memory map we plan to build in server.ts
    const asyncMap = new Map<string, { status: string; signature?: string }>();

    beforeAll(async () => {
        app = Fastify();

        app.post('/solana/enforce-tx', async (req, reply) => {
            const body = req.body as any;
            
            if (body.useSquadsCoSign) {
                const txnId = 'mock_squads_txn_001';
                asyncMap.set(txnId, { status: 'PENDING_BFT_CONSENSUS' });

                // Simulate background async worker (Squads payload generation)
                setTimeout(() => {
                    asyncMap.set(txnId, { status: 'APPROVED', signature: 'squads-sig-789' });
                }, 100);

                return reply.status(202).send({
                    status: 'PENDING_BFT_CONSENSUS',
                    transactionId: txnId
                });
            }

            return reply.status(200).send({
                decision: 'ALLOW',
                signature: 'instant-sig-123'
            });
        });

        app.get('/solana/enforce-tx/status', async (req, reply) => {
            const query = req.query as any;
            const txnState = asyncMap.get(query.txnId);
            
            if (!txnState) return reply.status(404).send({ error: 'Not found' });

            if (txnState.status === 'APPROVED') {
                return reply.status(200).send(txnState);
            }
            return reply.status(202).send(txnState);
        });

        await app.ready();
    });

    afterAll(async () => {
        await app.close();
    });

    it('returns an instant 200 ALLOW if useSquadsCoSign is false', async () => {
        const response = await app.inject({
            method: 'POST',
            url: '/solana/enforce-tx',
            payload: { useSquadsCoSign: false }
        });

        expect(response.statusCode).toBe(200);
        expect(JSON.parse(response.payload).decision).toBe('ALLOW');
    });

    it('returns 202 and then resolves to 200 via polling when useSquadsCoSign is true', async () => {
        // 1. Initial trigger
        const parseRes = await app.inject({
            method: 'POST',
            url: '/solana/enforce-tx',
            payload: { useSquadsCoSign: true }
        });

        expect(parseRes.statusCode).toBe(202);
        const data = JSON.parse(parseRes.payload);
        expect(data.status).toBe('PENDING_BFT_CONSENSUS');
        const txnId = data.transactionId;

        // 2. Poll immediately (should still be 202)
        const poll1 = await app.inject({
            method: 'GET',
            url: `/solana/enforce-tx/status?txnId=${txnId}`
        });
        expect(poll1.statusCode).toBe(202);

        // 3. Wait for background worker to complete
        await new Promise(r => setTimeout(r, 150));

        // 4. Final poll (should be 200)
        const poll2 = await app.inject({
            method: 'GET',
            url: `/solana/enforce-tx/status?txnId=${txnId}`
        });
        expect(poll2.statusCode).toBe(200);
        expect(JSON.parse(poll2.payload).status).toBe('APPROVED');
        expect(JSON.parse(poll2.payload).signature).toBe('squads-sig-789');
    });
});
