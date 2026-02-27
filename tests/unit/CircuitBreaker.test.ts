import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CircuitBreaker, getCircuitBreaker } from '../../src/infrastructure/CircuitBreaker';

describe('CircuitBreaker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('should initialize in CLOSED state', () => {
        const breaker = new CircuitBreaker({ name: 'testService' });
        expect(breaker.getStatus().state).toBe('CLOSED');
    });

    it('should allow execution when CLOSED and return result', async () => {
        const breaker = new CircuitBreaker({ name: 'testService' });
        const result = await breaker.execute(async () => 'success');
        expect(result).toBe('success');
        expect(breaker.getStatus().failures).toBe(0);
    });

    it('should record failure and eventually transition to OPEN state', async () => {
        const breaker = new CircuitBreaker({ failureThreshold: 2, name: 'testService' });

        // First failure
        await expect(breaker.execute(async () => { throw new Error('fail 1'); })).rejects.toThrow('fail 1');
        expect(breaker.getStatus().failures).toBe(1);
        expect(breaker.getStatus().state).toBe('CLOSED');

        // Second failure transitions to OPEN (threshold met)
        await expect(breaker.execute(async () => { throw new Error('fail 2'); })).rejects.toThrow('fail 2');
        expect(breaker.getStatus().failures).toBe(2);
        expect(breaker.getStatus().state).toBe('OPEN');
    });

    it('should deny execution with TERMINAL REFUSAL when OPEN', async () => {
        const breaker = new CircuitBreaker({ failureThreshold: 1, name: 'testService' });
        await expect(breaker.execute(async () => { throw new Error('fail'); })).rejects.toThrow();

        // Circuit is now OPEN
        await expect(breaker.execute(async () => 'success')).rejects.toThrow(/\[TERMINAL REFUSAL\] Circuit OPEN/);
    });

    it('should transition to HALF_OPEN after recovery time and allow retry', async () => {
        const breaker = new CircuitBreaker({ failureThreshold: 1, recoveryTimeMs: 1000, name: 'testService' });
        await expect(breaker.execute(async () => { throw new Error('fail'); })).rejects.toThrow();

        expect(breaker.getStatus().state).toBe('OPEN');

        // Advance time to surpass recovery setting
        vi.advanceTimersByTime(1500);

        expect(breaker.getStatus().state).toBe('HALF_OPEN');

        // Subsequent success should close the circuit
        const result = await breaker.execute(async () => 'recovered');
        expect(result).toBe('recovered');
        expect(breaker.getStatus().state).toBe('CLOSED');
        expect(breaker.getStatus().failures).toBe(0);
    });
});
