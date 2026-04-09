import { describe, it, expect, vi } from 'vitest';
import { withAegis, AegisConfig } from '../../src/sdk/AegisAgentWrapper';
import { VersionedTransaction } from '@solana/web3.js';

// Mock node-fetch to simulate Firewall responses and timeouts
const fetchMock = vi.fn();
vi.mock('node-fetch', () => {
    return {
        default: (...args: any[]) => fetchMock(...args)
    };
});

describe('AegisAgentWrapper Strict Mode & Async Strategy', () => {

    const mockAgentAction = async () => {
        // Mocking a serialized simple tx
        return {
            serialize: () => new Uint8Array(10)
        } as unknown as VersionedTransaction;
    };

    it('fallbackOnTimeout = true (Legacy): Fails open if Firewall times out', async () => {
        // Simulate an AbortError from timeout
        fetchMock.mockRejectedValueOnce({ name: 'AbortError', message: 'The operation was aborted' });

        const config: AegisConfig = {
            firewallUrl: 'http://localhost',
            fallbackOnTimeout: true,
            timeoutMs: 400
        };

        const execute = withAegis(mockAgentAction, config);
        const result = await execute();

        expect(result.success).toBe(false);
        expect(result.decision).toBe('FALLBACK');
        expect(result.error).toContain('Graceful fallback executed');
    });

    it('fallbackOnTimeout = false (Strict Mode): Blocks instantly if Firewall times out', async () => {
        // Simulate an AbortError from timeout
        fetchMock.mockRejectedValueOnce({ name: 'AbortError', message: 'The operation was aborted' });

        const config: AegisConfig = {
            firewallUrl: 'http://localhost',
            fallbackOnTimeout: false,
            timeoutMs: 400
        };

        const execute = withAegis(mockAgentAction, config);
        const result = await execute();

        expect(result.success).toBe(false);
        expect(result.decision).toBe('BLOCK');
        expect(result.error).toContain('Aegis Strict Mode Enforced');
    });

    it('successfully processes an ALLOW decision from the firewall', async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ decision: 'ALLOW', signature: 'mock-sig-123' })
        });

        const config: AegisConfig = {
            firewallUrl: 'http://localhost',
            fallbackOnTimeout: false
        };

        const execute = withAegis(mockAgentAction, config);
        const result = await execute();

        expect(result.success).toBe(true);
        expect(result.decision).toBe('ALLOW');
        expect(result.txSignature).toBe('mock-sig-123');
    });

    describe('Squads V4 Async Orchestration', () => {
        it('polls for Firewall 2-of-2 multisig approval without blocking the agent thread', async () => {
            // Step 1: SDK requests the TEE to create a proposal and sign
            fetchMock.mockResolvedValueOnce({
                ok: true,
                status: 202,
                json: async () => ({ status: 'PENDING_BFT_CONSENSUS', transactionId: 'txn_123' })
            });

            // Step 2: SDK polls and gets a final signature from the TEE
            fetchMock.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ status: 'APPROVED', signature: 'squads-tx-sig-456' })
            });

            const config: AegisConfig = {
                firewallUrl: 'http://localhost',
                useSquadsCoSign: true,
                fallbackOnTimeout: false,
                timeoutMs: 5000 // Higher timeout for asynchronous squad polling
            };

            const execute = withAegis(mockAgentAction, config);
            const result = await execute();

            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(result.success).toBe(true);
            expect(result.decision).toBe('ALLOW');
            expect(result.txSignature).toBe('squads-tx-sig-456');
        });
    });

});
