import Fastify from 'fastify';
import phalaEntrypoint from './phala-entry';
import { SolanaAnchor } from './infrastructure/SolanaAnchor';
import { SolanaTransactionFirewall } from './infrastructure/SolanaTransactionFirewall';
import { SquadsGovernance } from './infrastructure/SquadsGovernance';
import { AegisSigner } from './infrastructure/AegisSigner';
import { X402PayGate } from './infrastructure/X402PayGate';
import { TrustTier, ToolExecutionReceipt } from './types';

const fastify = Fastify({ logger: true });

// Initialize Solana infrastructure
const signer = new AegisSigner();
const solanaAnchor = new SolanaAnchor(process.env.SOLANA_CLUSTER || 'devnet');
const solanaFirewall = new SolanaTransactionFirewall(signer);
const squadsGovernance = new SquadsGovernance({
    cluster: process.env.SOLANA_CLUSTER || 'devnet',
    multisigPda: process.env.SQUADS_MULTISIG_PDA,
});
const x402Gate = new X402PayGate();

console.log(`[Aegis TEE] Enclave DID: ${signer.enclaveDid}`);
console.log(`[Aegis TEE] Solana Payer: ${solanaAnchor.getPayerPublicKey()}`);

// ═══════════════════════════════════════════════════════════════
// EXISTING ENDPOINTS — TEE Policy Enforcement
// ═══════════════════════════════════════════════════════════════

// Health check endpoint for dstack orchestration
fastify.get('/health', async (request, reply) => {
    return {
        status: 'alive',
        enclaveDid: signer.enclaveDid,
        solanaCluster: process.env.SOLANA_CLUSTER || 'devnet',
        solanaPayer: solanaAnchor.getPayerPublicKey(),
        features: [
            'tee-enforcement',
            'solana-anchoring',
            'solana-tx-firewall',
            'squads-governance',
        ],
    };
});

// The main POST endpoint that receives the Agent's intent
fastify.post('/enforce', async (request, reply) => {
    try {
        // x402 Pay Gate check
        const clientIp = request.ip || 'unknown';
        const paymentHeader = request.headers['x-payment'] as string | undefined;
        const paymentRequired = x402Gate.checkPaymentRequired(clientIp, paymentHeader, '/enforce');

        if (paymentRequired) {
            return reply.status(402).send(paymentRequired);
        }

        // If payment header present, verify it
        if (paymentHeader) {
            const verification = await x402Gate.verifyPayment(paymentHeader);
            if (!verification.valid) {
                return reply.status(402).send({
                    error: 'Payment verification failed',
                    details: verification.error,
                });
            }
        }

        const payloadString = JSON.stringify(request.body);

        // Pass the payload directly to the isolated entrypoint
        const resultString = await phalaEntrypoint(payloadString);
        const result = JSON.parse(resultString);

        if (result.status === "denied") {
            reply.status(403).send(result);
        } else {
            reply.send(result);
        }
    } catch (e: any) {
        fastify.log.error(e);
        reply.status(500).send({
            status: "error",
            message: "Enclave processing failed",
            error: e.message
        });
    }
});

// The Healthtech (Path B) endpoint for HIPAA Agent constraints
fastify.post('/healthtech/enforce', async (request, reply) => {
    try {
        const payloadString = JSON.stringify(request.body);
        const { handleHealthtechRequest } = require('./phala-entry');
        const resultString = await handleHealthtechRequest(payloadString);
        const result = JSON.parse(resultString);

        if (result.status === "denied") {
            reply.status(403).send(result);
        } else {
            reply.send(result);
        }
    } catch (e: any) {
        fastify.log.error(e);
        reply.status(500).send({
            status: "error",
            message: "Healthtech Enclave processing failed",
            error: e.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════
// NEW: Solana Receipt Anchoring (Priority 1a)
// ═══════════════════════════════════════════════════════════════

/**
 * POST /anchor-receipt
 * Anchor a signed ToolExecutionReceipt to Solana via SPL Memo.
 * Creates an immutable, publicly verifiable on-chain compliance record.
 */
fastify.post('/anchor-receipt', async (request, reply) => {
    try {
        const body = request.body as {
            receipt: ToolExecutionReceipt;
            decision: 'approved' | 'denied';
        };

        if (!body.receipt || !body.decision) {
            return reply.status(400).send({
                error: 'Missing required fields: receipt, decision',
            });
        }

        const result = await solanaAnchor.anchorReceipt(
            body.receipt,
            body.decision,
            signer.enclaveDid
        );

        return reply.send({
            status: 'anchored',
            ...result,
            enclaveDid: signer.enclaveDid,
            message: `Receipt anchored to Solana ${process.env.SOLANA_CLUSTER || 'devnet'}. ` +
                `Verify at ${result.explorerUrl}`,
        });
    } catch (e: any) {
        fastify.log.error(e);
        return reply.status(500).send({
            status: 'error',
            message: 'Anchoring failed',
            error: e.message,
            hint: 'Ensure payer has SOL balance. On devnet, use /airdrop first.',
        });
    }
});

/**
 * GET /verify/:txSignature
 * Public verifier — fetches tx from Solana, parses memo, confirms integrity.
 * Any third-party auditor can use this to verify an enforcement decision.
 */
fastify.get('/verify/:txSignature', async (request, reply) => {
    try {
        const { txSignature } = request.params as { txSignature: string };

        const verification = await solanaAnchor.verifyAnchoredReceipt(txSignature);

        return reply.send({
            ...verification,
            verifierVersion: 'aegis-v1',
            cluster: process.env.SOLANA_CLUSTER || 'devnet',
            explorerUrl: `https://explorer.solana.com/tx/${txSignature}?cluster=${process.env.SOLANA_CLUSTER || 'devnet'}`,
        });
    } catch (e: any) {
        fastify.log.error(e);
        return reply.status(500).send({
            status: 'error',
            message: 'Verification failed',
            error: e.message,
        });
    }
});

/**
 * POST /airdrop
 * Request SOL airdrop on devnet for the payer account.
 */
fastify.post('/airdrop', async (request, reply) => {
    if ((process.env.SOLANA_CLUSTER || 'devnet') === 'mainnet-beta') {
        return reply.status(403).send({ error: 'Airdrop not available on mainnet' });
    }

    try {
        const sig = await solanaAnchor.requestAirdrop();
        return reply.send({
            status: 'airdrop_success',
            txSignature: sig,
            payer: solanaAnchor.getPayerPublicKey(),
            amount: '1 SOL',
        });
    } catch (e: any) {
        return reply.status(500).send({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// NEW: Solana Transaction Firewall (Priority 1c)
// ═══════════════════════════════════════════════════════════════

/**
 * POST /solana/enforce-tx
 * Inspect a serialized Solana transaction BEFORE signing/broadcast.
 * Parses instructions and enforces policy rules at the instruction level.
 */
fastify.post('/solana/enforce-tx', async (request, reply) => {
    try {
        const body = request.body as {
            serializedTx: string;       // Base64-encoded transaction
            walletPubkey: string;
            agentTier?: string;
            environment?: string;
        };

        if (!body.serializedTx || !body.walletPubkey) {
            return reply.status(400).send({
                error: 'Missing required fields: serializedTx (base64), walletPubkey',
            });
        }

        const result = await solanaFirewall.inspectTransaction(
            body.serializedTx,
            body.walletPubkey
        );

        const statusCode = result.decision === 'BLOCK' ? 403
            : result.decision === 'REQUIRE_HUMAN' ? 202
            : 200;

        return reply.status(statusCode).send({
            ...result,
            enclaveDid: signer.enclaveDid,
            cluster: process.env.SOLANA_CLUSTER || 'devnet',
        });
    } catch (e: any) {
        fastify.log.error(e);
        return reply.status(500).send({
            status: 'error',
            message: 'Transaction inspection failed',
            error: e.message,
        });
    }
});

// ═══════════════════════════════════════════════════════════════
// NEW: Squads V4 Human-in-the-Loop Governance (Priority 1b)
// ═══════════════════════════════════════════════════════════════

/**
 * POST /governance/evaluate
 * Evaluate an agent action through the Squads V4 governance engine.
 * Routes to AUTONOMOUS / REQUIRE_HUMAN / BLOCKED based on risk.
 * EU AI Act Article 14 (Human Oversight) compliance.
 */
fastify.post('/governance/evaluate', async (request, reply) => {
    try {
        const body = request.body as {
            anomalyScore: number;
            agentTier: string;
            estimatedValue: number;
            agentDid: string;
            toolId: string;
            actionType: string;
            parameters?: Record<string, unknown>;
        };

        if (body.anomalyScore === undefined || !body.agentTier || !body.agentDid) {
            return reply.status(400).send({
                error: 'Missing fields: anomalyScore, agentTier, agentDid',
            });
        }

        const tier = body.agentTier as TrustTier;
        if (!Object.values(TrustTier).includes(tier)) {
            return reply.status(400).send({
                error: `Invalid agentTier: ${body.agentTier}. Must be T1-T4.`,
            });
        }

        const result = await squadsGovernance.evaluateAction(
            body.anomalyScore,
            tier,
            body.estimatedValue || 0,
            {
                agentDid: body.agentDid,
                toolId: body.toolId || 'unknown',
                actionType: body.actionType || 'unknown',
                parameters: body.parameters || {},
            }
        );

        const statusCode = result.decision === 'BLOCKED' ? 403
            : result.decision === 'REQUIRE_HUMAN' ? 202
            : 200;

        return reply.status(statusCode).send({
            ...result,
            enclaveDid: signer.enclaveDid,
            governanceProtocol: 'squads-v4',
            euAiActCompliance: {
                article14: result.decision === 'REQUIRE_HUMAN'
                    ? 'ACTIVE — Human oversight triggered'
                    : result.decision === 'BLOCKED'
                    ? 'ENFORCED — Action blocked by automated risk assessment'
                    : 'MONITORING — Low-risk autonomous operation',
            },
        });
    } catch (e: any) {
        fastify.log.error(e);
        return reply.status(500).send({
            status: 'error',
            message: 'Governance evaluation failed',
            error: e.message,
        });
    }
});

/**
 * GET /governance/config
 * Returns the current governance configuration and Squads setup instructions.
 */
fastify.get('/governance/config', async (request, reply) => {
    return {
        protocol: 'squads-v4',
        thresholds: {
            humanReview: 0.60,
            hardBlock: 0.80,
        },
        tierSpendingLimits: {
            T1: '0 SOL (Observer — no spending)',
            T2: '1 SOL (Advisor)',
            T3: '10 SOL (Operator)',
            T4: '100 SOL (Autonomous)',
        },
        euAiActMapping: {
            'Article 9': 'Risk Management — anomaly detection thresholds',
            'Article 14': 'Human Oversight — Squads multisig approval for moderate risk',
            'Article 15': 'Accuracy & Cybersecurity — TEE attestation + transaction firewall',
        },
        multisigPda: process.env.SQUADS_MULTISIG_PDA || 'NOT_CONFIGURED — create via /governance/setup',
    };
});


// ═══════════════════════════════════════════════════════════════
// NEW: TEE Attestation Status (Priority 3)
// ═══════════════════════════════════════════════════════════════

/**
 * GET /attestation/status
 * Returns the current TEE attestation status with verification details.
 */
fastify.get('/attestation/status', async (request, reply) => {
    try {
        // Attempt to fetch live attestation quote
        const quoteResponse = await fetch('http://127.0.0.1:8090/quote', {
            signal: AbortSignal.timeout(2000),
        }).catch(() => null);

        const isRunningInTEE = quoteResponse?.ok ?? false;
        let quoteData = null;

        if (isRunningInTEE && quoteResponse) {
            quoteData = await quoteResponse.json().catch(() => null);
        }

        return reply.send({
            teeProvider: 'Phala Network dstack (Intel TDX)',
            isRunningInTEE,
            attestationStatus: isRunningInTEE ? 'HARDWARE_ATTESTED' : 'LOCAL_MOCK',
            enclaveDid: signer.enclaveDid,
            enclavePublicKey: signer.getPublicKeyHex(),
            signatureAlgorithm: 'Ed25519 (TweetNaCl)',
            quote: quoteData ? {
                present: true,
                measurementHash: quoteData.mr_enclave || quoteData.measurement || 'available',
                reportData: quoteData.report_data ? 'bound' : 'not_present',
            } : {
                present: false,
                fallback: 'LOCAL_MOCK_ATTESTATION',
                note: 'Deploy to Phala Cloud for real hardware attestation',
            },
            compliance: {
                euAiActArticle12: 'Record Keeping — TEE provides tamper-proof execution logs',
                euAiActArticle15: 'Cybersecurity — Hardware enclave isolation',
            },
        });
    } catch (e: any) {
        return reply.status(500).send({
            error: 'Attestation status check failed',
            message: e.message,
        });
    }
});

// ═══════════════════════════════════════════════════════════════
// NEW: x402 Monetization Status (Priority 2)
// ═══════════════════════════════════════════════════════════════

/**
 * GET /monetization/status
 * Returns x402 pay-per-inference metrics and configuration.
 */
fastify.get('/monetization/status', async (request, reply) => {
    return {
        protocol: 'x402-v2',
        ...x402Gate.getMetrics(),
        description: 'Pay-per-inference via HTTP 402. Agents pay USDC micro-fees for compliance checks.',
        howItWorks: [
            '1. Agent sends POST /enforce',
            '2. If free-tier exhausted: server returns 402 with payment requirements',
            '3. Agent pays USDC via Solana transaction',
            '4. Agent retries with X-PAYMENT header containing tx signature',
            '5. Server verifies payment → processes enforcement → returns receipt',
        ],
    };
});

// ═══════════════════════════════════════════════════════════════
// API Documentation
// ═══════════════════════════════════════════════════════════════

fastify.get('/api/docs', async (request, reply) => {
    return {
        name: 'Aegis-12 Compliance Gateway',
        version: '2.0.0',
        description: 'TEE-hardened policy enforcement for autonomous AI agents on Solana',
        enclaveDid: signer.enclaveDid,
        endpoints: {
            // Core Enforcement
            'POST /enforce': 'DeFi policy enforcement (TEE-backed, x402 gated)',
            'POST /healthtech/enforce': 'HIPAA policy enforcement',

            // Solana Integration
            'POST /anchor-receipt': 'Anchor signed receipt to Solana via SPL Memo',
            'GET /verify/:txSignature': 'Public verifier for anchored receipts',
            'POST /solana/enforce-tx': 'Pre-signing transaction firewall (instruction-level inspection)',
            'POST /airdrop': 'Request devnet SOL for payer account',

            // Squads V4 Governance
            'POST /governance/evaluate': 'Risk-based governance routing (Squads V4 multisig)',
            'GET /governance/config': 'Current governance thresholds and spending limits',

            // x402 Monetization
            'GET /monetization/status': 'x402 pay-per-inference configuration and metrics',

            // Infrastructure
            'GET /health': 'Health check with feature flags',
            'GET /attestation/status': 'TEE attestation verification status',
            'GET /api/docs': 'This documentation',
        },
        solanaIntegration: {
            cluster: process.env.SOLANA_CLUSTER || 'devnet',
            payer: solanaAnchor.getPayerPublicKey(),
            programs: [
                'SPL Memo (receipt anchoring)',
                'Squads V4 (human-in-the-loop governance)',
                'x402 USDC (pay-per-inference)',
            ],
        },
        compliance: {
            euAiAct: ['Article 9', 'Article 10', 'Article 12', 'Article 13', 'Article 14', 'Article 15'],
            mitre: ['T1021', 'T1027', 'T1098', 'T1203', 'T1485', 'T1486', 'T1528', 'T1537', 'T1548', 'T1552', 'T1557', 'T1567'],
            hipaa: ['Privacy Rule 164.502', 'Minimum Necessary Standard'],
        },
    };
});

// ═══════════════════════════════════════════════════════════════
// Server Start
// ═══════════════════════════════════════════════════════════════

const start = async () => {
    try {
        // Must listen on 0.0.0.0 for Docker/dstack networking
        const port = process.env.PORT ? parseInt(process.env.PORT) : 8000;
        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`[Aegis TEE] Hardware PEP listening on port ${port}`);
        console.log(`[Aegis TEE] Endpoints: /enforce, /solana/enforce-tx, /governance/evaluate, /anchor-receipt, /verify/:tx`);
        console.log(`[Aegis TEE] Solana Cluster: ${process.env.SOLANA_CLUSTER || 'devnet'}`);
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();
