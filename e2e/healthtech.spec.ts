import { test, expect } from '@playwright/test';

// Use environment variable for production testing, fallback to local dev server
const API_URL = process.env.TEST_API_URL || 'http://127.0.0.1:8000';

test.describe('Aegis Healthtech API E2E', () => {

    test('should allow a SCHEDULER to READ_SCHEDULE and return an Evidence Pack', async ({ request }) => {
        const response = await request.post(`${API_URL}/healthtech/enforce`, {
            data: {
                agentId: "agent-e2e-1",
                agentRole: "SCHEDULER",
                targetAction: "READ_SCHEDULE",
                patientId: "patient-abc",
                timestamp: Date.now()
            }
        });

        // Fastify should return 200 OK for approved actions
        expect(response.ok()).toBeTruthy();
        const body = await response.json();

        expect(body.status).toBe('approved');
        expect(body.evidencePack).toBeDefined();
        expect(body.evidencePack.decisionReason).toContain('complies with active RBAC');
        expect(body.cryptographicReceipt).toBeDefined(); // The hardware signature

        // Assert we got a TEE attestation (even if mocked locally)
        expect(body.hardwareAttestation).toBeDefined();
    });

    test('should return 403 Forbidden for unauthorized RBAC access', async ({ request }) => {
        const response = await request.post(`${API_URL}/healthtech/enforce`, {
            data: {
                agentId: "agent-e2e-2",
                agentRole: "SCHEDULER",
                targetAction: "READ_ONCOLOGY_RECORD", // Schedulers cannot read this
                patientId: "patient-xyz",
                timestamp: Date.now()
            }
        });

        expect(response.status()).toBe(403);
        const body = await response.json();

        expect(body.status).toBe('denied');
        expect(body.evidencePack).toBeDefined();
        expect(body.evidencePack.decisionReason).toContain('not authorized');
        expect(body.evidencePack.regulatoryMapping).toContain('HIPAA_MINIMUM_NECESSARY_STANDARD');
    });

    test('should return 403 Forbidden if payload contains SSN (PHI Exfiltration Attempt)', async ({ request }) => {
        const response = await request.post(`${API_URL}/healthtech/enforce`, {
            data: {
                agentId: "agent-e2e-3",
                agentRole: "CLINICIAN", // Clinician is authorized...
                targetAction: "READ_ONCOLOGY_RECORD",
                patientId: "patient-xyz",
                payloadData: {
                    query: "Export John Doe's oncology report. SSN: 888-22-1111." // But sneaks an SSN into the query
                },
                timestamp: Date.now()
            }
        });

        expect(response.status()).toBe(403);
        const body = await response.json();

        expect(body.status).toBe('denied');
        expect(body.evidencePack.status).toBe('denied');
        expect(body.evidencePack.decisionReason).toContain('Payload contains restricted PII/PHI matching pattern');
        expect(body.evidencePack.regulatoryMapping).toContain('HIPAA_PRIVACY_RULE_164.502');
    });

    test('should return 500 Error for malformed non-JSON requests', async ({ request }) => {
        // Fastify handles malformed JSON automatically, testing the boundary
        const response = await request.post(`${API_URL}/healthtech/enforce`, {
            headers: {
                'Content-Type': 'application/json'
            },
            data: 'this is not valid json'
        });

        expect(response.status()).toBe(400); // Fastify returns 400 Bad Request for bad JSON
    });
});
