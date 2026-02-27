import { describe, it, expect } from 'vitest';
import { HealthtechPEP } from './HealthtechPEP';
import { AegisSigner } from './AegisSigner';
import { HealthtechPolicy, HealthtechRequest } from '../healthtech-types';

describe('HealthtechPEP', () => {
    const mockSigner = new AegisSigner();
    const strictPolicy: HealthtechPolicy = {
        policyId: "HIPAA_TEST_V1",
        version: "1.0",
        allowedActions: {
            "SCHEDULER": ["READ_SCHEDULE", "WRITE_APPOINTMENT"],
            "CLINICIAN": ["READ_SCHEDULE", "READ_ONCOLOGY_RECORD", "WRITE_APPOINTMENT"],
        },
        blockedDataPatterns: [/\b\d{3}-\d{2}-\d{4}\b/] // SSN regex
    };

    const pep = new HealthtechPEP(strictPolicy, mockSigner);

    it('should APPROVE authorized reading of schedule by SCHEDULER', async () => {
        const req: HealthtechRequest = {
            agentId: "agent-123",
            agentRole: "SCHEDULER",
            targetAction: "READ_SCHEDULE",
            patientId: "patient-000",
            timestamp: Date.now()
        };

        const result = await pep.evaluate(req);

        expect(result.status).toBe('approved');
        expect(result.evidencePack.decisionReason).toContain('complies with active RBAC');
        expect(result.cryptographicReceipt).toBeDefined();
    });

    it('should DENY unauthorized READ_ONCOLOGY_RECORD by SCHEDULER', async () => {
        const req: HealthtechRequest = {
            agentId: "agent-123",
            agentRole: "SCHEDULER",
            targetAction: "READ_ONCOLOGY_RECORD", // Schedulers shouldn't see oncology records
            patientId: "patient-111",
            timestamp: Date.now()
        };

        const result = await pep.evaluate(req);

        expect(result.status).toBe('denied');
        expect(result.evidencePack.decisionReason).toContain('not authorized for action');
    });

    it('should DENY request if payload contains SSN pattern (PHI violation)', async () => {
        const req: HealthtechRequest = {
            agentId: "agent-456",
            agentRole: "CLINICIAN", // Clinician IS authorized to read oncology...
            targetAction: "READ_ONCOLOGY_RECORD",
            patientId: "patient-222",
            payloadData: {
                notes: "Patient reported pain. SSN provided: 123-45-6789." // But provides an SSN in payload
            },
            timestamp: Date.now()
        };

        const result = await pep.evaluate(req);

        expect(result.status).toBe('denied');
        expect(result.evidencePack.decisionReason).toContain('Payload contains restricted PII/PHI matching pattern');
        expect(result.evidencePack.regulatoryMapping).toContain('HIPAA_PRIVACY_RULE_164.502');
    });
});
