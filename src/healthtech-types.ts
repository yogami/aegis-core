export interface HealthtechRequest {
    agentId: string;
    agentRole: 'SCHEDULER' | 'CLINICIAN' | 'BILLING';
    targetAction: 'READ_SCHEDULE' | 'READ_ONCOLOGY_RECORD' | 'WRITE_APPOINTMENT';
    patientId: string;
    payloadData?: any;
    timestamp: number;
}

export interface HealthtechPolicy {
    policyId: string;
    version: string;
    allowedActions: Record<string, string[]>; // Map agentRole to allowed targetActions
    blockedDataPatterns: RegExp[]; // Patterns that trigger automatic redaction/denial (e.g. SSNs)
}

export interface EvidencePack {
    status: 'approved' | 'denied';
    auditId: string;
    timestamp: number;
    decisionReason: string;
    regulatoryMapping: string[]; // e.g., ["HIPAA_MINIMUM_NECESSARY_STANDARD"]
}

export interface HealthtechResponse {
    status: 'approved' | 'denied';
    evidencePack: EvidencePack;
    cryptographicReceipt?: string; // Signed proof
    hardwareAttestation?: string; // TEE quote
}
