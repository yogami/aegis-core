"use strict";
/**
 * Circuit Breaker Pattern (TEE Port)
 *
 * Tracks consecutive failures and opens the circuit to prevent
 * unauthorized execution. Ported for Phala Network JS Enclave.
 *
 * States:
 *   CLOSED  → Normal operation, requests pass through
 *   OPEN    → Too many failures, requests blocked
 *   HALF_OPEN → Testing recovery, one request allowed
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CircuitBreaker = void 0;
exports.getCircuitBreaker = getCircuitBreaker;
exports.getAllCircuitBreakerStatuses = getAllCircuitBreakerStatuses;
const DEFAULT_CONFIG = {
    failureThreshold: 3,
    recoveryTimeMs: 30_000,
    name: 'unknown',
};
class CircuitBreaker {
    state = 'CLOSED';
    failures = 0;
    lastFailureTime = null;
    lastSuccessTime = null;
    config;
    constructor(config) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }
    getStatus() {
        // Check if we should transition from OPEN to HALF_OPEN
        if (this.state === 'OPEN' && this.lastFailureTime) {
            const elapsed = Date.now() - this.lastFailureTime;
            if (elapsed >= this.config.recoveryTimeMs) {
                this.state = 'HALF_OPEN';
            }
        }
        return {
            state: this.state,
            failures: this.failures,
            lastFailure: this.lastFailureTime,
            lastSuccess: this.lastSuccessTime,
            serviceName: this.config.name,
        };
    }
    canExecute() {
        const status = this.getStatus();
        return status.state !== 'OPEN';
    }
    recordSuccess() {
        this.failures = 0;
        this.state = 'CLOSED';
        this.lastSuccessTime = Date.now();
    }
    recordFailure() {
        this.failures++;
        this.lastFailureTime = Date.now();
        if (this.failures >= this.config.failureThreshold) {
            this.state = 'OPEN';
        }
    }
    reset() {
        this.state = 'CLOSED';
        this.failures = 0;
        this.lastFailureTime = null;
    }
    async execute(fn) {
        if (!this.canExecute()) {
            throw new Error(`[TERMINAL REFUSAL] Circuit OPEN for ${this.config.name} — service degraded or malicious intent detected. ` +
                `Recovery in ${Math.max(0, this.config.recoveryTimeMs - (Date.now() - (this.lastFailureTime || 0)))}ms`);
        }
        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        }
        catch (error) {
            this.recordFailure();
            throw error;
        }
    }
}
exports.CircuitBreaker = CircuitBreaker;
// Singleton registry for circuit breakers across the app
const breakers = new Map();
function getCircuitBreaker(name, config) {
    if (!breakers.has(name)) {
        breakers.set(name, new CircuitBreaker({ name, ...config }));
    }
    return breakers.get(name);
}
function getAllCircuitBreakerStatuses() {
    return Array.from(breakers.values()).map(b => b.getStatus());
}
