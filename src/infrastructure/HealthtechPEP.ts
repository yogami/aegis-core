import { HealthtechRequest, HealthtechResponse, HealthtechPolicy, EvidencePack } from '../healthtech-types';
import { AegisSigner } from './AegisSigner';

export class HealthtechPEP {
    private policy: HealthtechPolicy;
    private signer: AegisSigner;

    constructor(policy: HealthtechPolicy, signer: AegisSigner) {
        this.policy = policy;
        this.signer = signer;
    }

    public async evaluate(request: HealthtechRequest): Promise<HealthtechResponse> {
        console.log(`[Aegis Healthtech] Evaluating request from Agent ${request.agentId} (${request.agentRole}) for ${request.targetAction}`);

        // 1. Role-Based Access Control (RBAC) Check
        const allowedActions = this.policy.allowedActions[request.agentRole] || [];
        if (!allowedActions.includes(request.targetAction)) {
            return this.generateDenial(
                request,
                `Role ${request.agentRole} is not authorized for action ${request.targetAction}.`,
                ['HIPAA_MINIMUM_NECESSARY_STANDARD']
            );
        }

        // 2. Data Exfiltration / PII Redaction Check
        if (request.payloadData) {
            const payloadString = JSON.stringify(request.payloadData);
            for (const pattern of this.policy.blockedDataPatterns) {
                if (pattern.test(payloadString)) {
                    return this.generateDenial(
                        request,
                        `Payload contains restricted PII/PHI matching pattern ${pattern.toString()}`,
                        ['HIPAA_PRIVACY_RULE_164.502']
                    );
                }
            }
        }

        // 3. Approval Generation
        return this.generateApproval(request);
    }

    private async generateDenial(request: HealthtechRequest, reason: string, regulations: string[]): Promise<HealthtechResponse> {
        const evidence: EvidencePack = {
            status: 'denied',
            auditId: `audit-ht-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            decisionReason: reason,
            regulatoryMapping: regulations
        };

        const evidenceString = JSON.stringify(evidence);
        const signature = this.signer.sign(evidenceString);

        console.error(`[Aegis Healthtech] Terminal Refusal: ${reason}`);

        return {
            status: 'denied',
            evidencePack: evidence,
            cryptographicReceipt: signature
        };
    }

    private async generateApproval(request: HealthtechRequest): Promise<HealthtechResponse> {
        const evidence: EvidencePack = {
            status: 'approved',
            auditId: `audit-ht-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp: Date.now(),
            decisionReason: 'Request complies with active RBAC and PHI policies.',
            regulatoryMapping: ['HIPAA_COMPLIANT']
        };

        const evidenceString = JSON.stringify(evidence);
        const signature = this.signer.sign(evidenceString);

        return {
            status: 'approved',
            evidencePack: evidence,
            cryptographicReceipt: signature
        };
    }
}
