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

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
    failureThreshold: number;   // failures before opening
    recoveryTimeMs: number;     // ms before trying half-open
    name: string;               // service name for logging
}

export interface CircuitBreakerStatus {
    state: CircuitState;
    failures: number;
    lastFailure: number | null;
    lastSuccess: number | null;
    serviceName: string;
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 3,
    recoveryTimeMs: 30_000,
    name: 'unknown',
};

export class CircuitBreaker {
    private state: CircuitState = 'CLOSED';
    private failures = 0;
    private lastFailureTime: number | null = null;
    private lastSuccessTime: number | null = null;
    private config: CircuitBreakerConfig;

    constructor(config: Partial<CircuitBreakerConfig> & { name: string }) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    getStatus(): CircuitBreakerStatus {
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

    canExecute(): boolean {
        const status = this.getStatus();
        return status.state !== 'OPEN';
    }

    recordSuccess(): void {
        this.failures = 0;
        this.state = 'CLOSED';
        this.lastSuccessTime = Date.now();
    }

    recordFailure(): void {
        this.failures++;
        this.lastFailureTime = Date.now();

        if (this.failures >= this.config.failureThreshold) {
            this.state = 'OPEN';
        }
    }

    reset(): void {
        this.state = 'CLOSED';
        this.failures = 0;
        this.lastFailureTime = null;
    }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (!this.canExecute()) {
            throw new Error(
                `[TERMINAL REFUSAL] Circuit OPEN for ${this.config.name} — service degraded or malicious intent detected. ` +
                `Recovery in ${Math.max(0, this.config.recoveryTimeMs - (Date.now() - (this.lastFailureTime || 0)))}ms`
            );
        }

        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        } catch (error) {
            this.recordFailure();
            throw error;
        }
    }
}

// Singleton registry for circuit breakers across the app
const breakers = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(name: string, config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
    if (!breakers.has(name)) {
        breakers.set(name, new CircuitBreaker({ name, ...config }));
    }
    return breakers.get(name)!;
}

export function getAllCircuitBreakerStatuses(): CircuitBreakerStatus[] {
    return Array.from(breakers.values()).map(b => b.getStatus());
}
