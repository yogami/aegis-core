// types.ts
// Ported from pdp-protocol/src/vera/types.ts for Aegis TEE Enclave

export type ISO8601 = string; // e.g. "2026-02-27T12:00:00Z"

export enum TrustTier {
    T1 = 'T1', // Observer
    T2 = 'T2', // Advisor
    T3 = 'T3', // Operator
    T4 = 'T4', // Autonomous (Aegis Focus)
}

export enum AgentPurpose {
    DATA_ANALYSIS = 'data_analysis',
    CUSTOMER_SERVICE = 'customer_service',
    FINANCIAL_OPERATIONS = 'financial_operations', // Aegis Focus
}

export interface PolicyDecision {
    decision: 'allow' | 'deny' | 'escalate';
    obligations?: PolicyObligation[];
    ttl: number;                    // Decision cache TTL in seconds
    reason: string;
}

export interface PolicyObligation {
    type: 'redact_fields' | 'require_approval' | 'step_up_auth'
    | 'rate_limit' | 'read_only_mode' | 'max_value_limit'
    | 'log_level_increase';
    parameters: Record<string, unknown>;
}

export interface ToolExecutionReceipt {
    actionId: string;               // Matches PoE actionId
    toolId: string;                 // Tool's SPIFFE ID or DID
    authorizationNonce: string;     // Nonce issued by PEP at authorization time
    parameters: Record<string, unknown>; // Canonical parameters received
    resultHash: string;             // SHA-256 of JCS-canonicalized result
    timestamp: ISO8601;
    signature: string;              // TEE's key (Ed25519)
}

export interface ProofOfExecution {
    actionId: string;               // UUID v7 (time-ordered)
    agentDid: string;               // Agent identity
    signerType: 'enforcer' | 'agent' | 'dual'; // Aegis TEE = enforcer
    signatureAlgorithm: 'Ed25519' | 'ECDSA-P256' | 'ML-DSA-65';
    action: {
        type: string;
        target: string;
        parameters: Record<string, unknown>;
        resultHash: string;
    };
    context: {
        sessionId: string;
        sequenceNumber: number;
        previousProofHash: string;
        triggeredBy: string;
    };
    decisionProvenance?: {
        pdpDecisionId: string;
        policyBundleHash: string;
        obligationsApplied: string[];
    };
    timestamp: {
        agentClock: ISO8601;
        verifiedSource?: 'rfc3161' | 'ntp-attested' | 'anchor-derived';
    };
    signature: string;              // Enclave Signature
    keyId: string;
    receiptHash?: string;
}

export interface PolicyEvaluationRequest {
    agent: {
        did: string;
        purpose: AgentPurpose;
        currentTier: TrustTier;
    };
    action: {
        toolId: string;
        actionType: string;
        parameters: Record<string, unknown>;
        estimatedValue?: number;
    };
    context: {
        sessionId: string;
        actionsThisSession: number;
        actionsThisHour: number;
        currentAnomalyScore: number;
        recentIncidents: number;
    };
}
