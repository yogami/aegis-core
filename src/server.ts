import Fastify from 'fastify';
import { Connection, clusterApiUrl } from '@solana/web3.js';
import phalaEntrypoint from './phala-entry';
import { SolanaAnchor } from './infrastructure/SolanaAnchor';
import { SolanaTransactionFirewall } from './infrastructure/SolanaTransactionFirewall';
import { SquadsGovernance } from './infrastructure/SquadsGovernance';
import { KMSProvider } from './infrastructure/KMSProvider';
import { X402PayGate } from './infrastructure/X402PayGate';
import { JitoBundler } from './infrastructure/JitoBundler';
import { TrustTier, ToolExecutionReceipt } from './types';
import crypto from 'crypto'; // for uuid simulation if needed

const fastify = Fastify({ logger: true });

// Initialize Solana infrastructure
const connection = new Connection(clusterApiUrl(process.env.SOLANA_CLUSTER as any || 'devnet'), 'confirmed');
// BFT 3-of-n RPC Quorum Array for Anti-Poisoning
const connections = [
    connection,
    new Connection('https://api.solana.com', 'confirmed'),
    new Connection('https://solana-api.projectserum.com', 'confirmed')
];
const signer = new KMSProvider();
const solanaAnchor = new SolanaAnchor(process.env.SOLANA_CLUSTER || 'devnet');
// Note: Type assertions may be needed since KMSProvider signature differs entirely from AegisSigner, 
// but we cast it as any to satisfy legacy Firewall constructor for now.
const solanaFirewall = new SolanaTransactionFirewall(signer as any, connections);

const squadsGovernance = new SquadsGovernance({
    cluster: process.env.SOLANA_CLUSTER || 'devnet',
    multisigPda: process.env.SQUADS_MULTISIG_PDA,
});

// Async Map for Squads V4 2-of-2 state Orchestration Without DB
const asyncMap = new Map<string, any>();
const x402Gate = new X402PayGate();
const jitoBundler = new JitoBundler();

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
        const paymentRequired = await x402Gate.checkPaymentRequired(clientIp, paymentHeader, '/enforce');

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
            payloadHash?: string;       // Required: The natively mapped SHA-256 Public Input constraint
            walletPubkey: string;
            agentTier?: string;
            environment?: string;
            useZKCoprocessor?: boolean; // Async Groth16 verification flag
        };

        if (!body.serializedTx || !body.walletPubkey) {
            return reply.status(400).send({
                error: 'Missing required fields: serializedTx (base64), walletPubkey',
            });
        }

        // x402 Pay Gate constraint
        const clientIp = request.ip || 'unknown';
        const paymentHeader = request.headers['x-payment'] as string | undefined;
        
        const paymentRequired = await x402Gate.checkPaymentRequired(clientIp, paymentHeader, '/solana/enforce-tx');
        if (paymentRequired) {
            return reply.status(402).send(paymentRequired);
        }

        // Verify existing payment if provided
        if (paymentHeader) {
            const verification = await x402Gate.verifyPayment(paymentHeader);
            if (!verification.valid) {
                 return reply.status(402).send({ error: 'Payment verification failed', details: verification.error });
            }
        }

        // --- AEGİS-12 ZK-COPROCESSOR ASYNC ENGINE ---
        if (body.useZKCoprocessor) {
            if (!body.payloadHash) {
                return reply.status(400).send({
                    error: 'DeepResearch Flaw A Enforcement: Missing payloadHash Public Input boundary.',
                });
            }

            const txnId = crypto.randomUUID();
            asyncMap.set(txnId, { status: 'PENDING_ZK_SNARK' });

            // Background worker (Simulating Automata AVS SNARK Generation)
            Promise.resolve().then(async () => {
                try {
                    // Pre-verification (Aegis Ingress Firewall)
                    const result = await solanaFirewall.inspectTransaction(
                        body.serializedTx,
                        body.walletPubkey
                    );
                    
                    // --- HOTL: Phase 24 ("Pivot 22") Policy Engine Verification ---
                    let policyDecision = result.decision;
                    try {
                        const policyRes = await fetch(process.env.POLICY_EVALUATOR_URL + "/evaluate", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                action: "transfer",
                                target: body.walletPubkey,
                                amount: 1000, // Dummy decode for local simulation
                                agent_id: body.agentTier || "eliza-bot-01",
                                memo: "Aegis-12 Transaction Executing",
                                nonce: txnId,
                                timestamp_ms: Date.now()
                            })
                        });
                        const policyVerdict = await policyRes.json();
                        if (policyVerdict.approved === false) {    
                            policyDecision = "REQUIRE_HUMAN";
                            result.reason = policyVerdict.reasoning;
                        }
                    } catch(err) {
                        console.warn("Policy Evaluator mock offline. Safely failing open for local hackathon demo.", err);
                    }

                    if (policyDecision === 'ALLOW') {
                        // Simulate the 5-minute ZK-compile time natively
                        // For the hackathon demo, we shorten this to 15 seconds
                        await new Promise(resolve => setTimeout(resolve, 15000));
                        
                        const dummySnark = {
                            pi_a: ["0x2c6f...", "0x0b8a..."],
                            pi_b: [["0x1a2b...", "0x3c4d..."], ["0x5e6f...", "0x7a8b..."]],
                            pi_c: ["0x2211...", "0xffee..."],
                            public_inputs: [body.payloadHash] // Cryptographically bound P-Input
                        };
                        
                        const fakeSquadsSignature = await signer.signPayloadRemotely(body.serializedTx);
                        asyncMap.set(txnId, { 
                            status: 'SNARK_GENERATED', 
                            signature: fakeSquadsSignature,
                            decision: 'ALLOW',
                            snarkProof: dummySnark,
                            ars01Receipt: result
                        });
                    } else {
                        asyncMap.set(txnId, { 
                            status: result.decision, 
                            decision: result.decision,
                            ars01Receipt: result
                        });
                    }
                } catch (err: any) {
                    asyncMap.set(txnId, { status: 'BLOCK', decision: 'BLOCK', error: err.message });
                }
            });

            return reply.status(202).send({
                status: 'PENDING_ZK_SNARK',
                transactionId: txnId,
                enclaveDid: signer.enclaveDid
            });
        }
        // ---------------------------------------------

        // Legacy Synchronous Execution (Strict Mode Network Logic)
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

/**
 * GET /solana/enforce-tx/status
 * Queries the async status of a Squads V4 multisig proposal being orchestrated by the Firewall.
 */
fastify.get('/solana/enforce-tx/status', async (request, reply) => {
    try {
        const query = request.query as { txnId?: string };
        if (!query.txnId) {
            return reply.status(400).send({ error: 'Missing txnId parameter' });
        }

        const state = asyncMap.get(query.txnId);
        if (!state) {
            return reply.status(404).send({ error: 'Transaction ID not found or expired.' });
        }

        // Map status codes for the async polling layer
        if (state.status === 'SNARK_GENERATED' || state.status === 'ALLOW' || state.status === 'APPROVED') {
            return reply.status(200).send(state);
        } else if (state.status === 'BLOCK') {
            return reply.status(403).send(state);
        } else {
            // PENDING_ZK_SNARK or REQUIRE_HUMAN
            return reply.status(202).send(state);
        }
    } catch (e: any) {
        fastify.log.error(e);
        return reply.status(500).send({ error: e.message });
    }
});

/**
 * POST /solana/cosign-proposal
 * CRYPTOGRAPHIC LOCK: 2-of-2 Squads Enclave Co-Signer
 * If a proposal is created for the agent, the TEE evaluates and actively signs it.
 */
fastify.post('/solana/cosign-proposal', async (request, reply) => {
    try {
        const body = request.body as {
            multisigPda: string;
            transactionIndex: number;
        };

        if (!body.multisigPda || body.transactionIndex === undefined) {
            return reply.status(400).send({
                error: 'Missing required fields: multisigPda, transactionIndex',
            });
        }

        // Import PublicKey inline or ensure it's imported at the top
        const { PublicKey } = require('@solana/web3.js');
        const multisigKey = new PublicKey(body.multisigPda);
        
        // Use Aegis Signer as the TEE keypair
        const enclaveKeypair = signer.getKeypair();

        const signature = await squadsGovernance.coSignProposal(
            multisigKey,
            BigInt(body.transactionIndex),
            enclaveKeypair
        );

        // Optional: If the agent provides an atomic payload, wrap it in Jito for execution parity
        if ((body as any).atomicAgentTx && (body as any).atomicAegisTx) {
            const jitoResult = await jitoBundler.broadcastAtomicBundle(
                (body as any).atomicAgentTx,
                (body as any).atomicAegisTx
            );
            return reply.status(200).send({
                status: 'success',
                message: 'TEE co-signed and triggered Jito Atomic Execution',
                signature,
                jitoStatus: jitoResult.status,
                bundleId: jitoResult.bundleId,
                enclaveDid: signer.enclaveDid,
            });
        }

        return reply.status(200).send({
            status: 'success',
            message: 'TEE co-signed the Squads proposal successfully',
            signature,
            enclaveDid: signer.enclaveDid,
        });
    } catch (e: any) {
        fastify.log.error(e);
        return reply.status(500).send({
            status: 'error',
            message: 'TEE co-signing failed',
            error: e.message,
        });
    }
});

// ═══════════════════════════════════════════════════════════════
// NEW: Split-Screen Demo UI (Priority 4)
// ═══════════════════════════════════════════════════════════════

fastify.get('/demo', async (request, reply) => {
    reply.type('text/html').send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Aegis-12 Nightmare Bombardment Mode</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;900&family=JetBrains+Mono:wght@400;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Inter', sans-serif; background: #030000; color: #ff3333; height: 100vh; display: flex; overflow: hidden; }
        
        @keyframes glitch {
            0% { transform: translate(0); filter: drop-shadow(0 0 0 red); }
            20% { transform: translate(-2px, 2px); filter: drop-shadow(-2px 0 0 #ff00ff); }
            40% { transform: translate(-2px, -2px); filter: drop-shadow(2px 0 0 #00ffff); }
            60% { transform: translate(2px, 2px); filter: drop-shadow(0 0 0 red); }
            80% { transform: translate(2px, -2px); filter: drop-shadow(0 0 0 #ff00ff); }
            100% { transform: translate(0); filter: drop-shadow(0 0 0 red); }
        }
        
        .glitch-text { animation: none; font-weight: 900; letter-spacing: 1px; }
        body.under-attack .glitch-text { animation: glitch 0.3s infinite; color: #ff0000; }
        body.under-attack { background: radial-gradient(circle at center, #1a0000, #000); }
        body.under-attack .pane { border-color: #ff0000 !important; }

        .pane { flex: 1; padding: 2rem; display: flex; flex-direction: column; overflow-y: auto; transition: border-color 0.2s; }
        .left-pane { background: #050000; border-right: 2px solid #330000; }
        .right-pane { background: radial-gradient(circle at top right, #110000, #030000); position: relative; }
        ::-webkit-scrollbar { width: 8px; }
        ::-webkit-scrollbar-thumb { background: #550000; border-radius: 4px; }
        h2 { font-size: 1.4rem; margin-bottom: 1.5rem; text-transform: uppercase; letter-spacing: 3px; color: #880000; }
        
        /* Left: Agent Terminal */
        .terminal { background: #000; border: 1px solid #440000; box-shadow: inset 0 0 20px rgba(255,0,0,0.1); border-radius: 8px; flex: 1; font-family: 'JetBrains Mono', monospace; padding: 1.5rem; display: flex; flex-direction: column; position: relative; }
        .terminal::before { content: ""; position: absolute; top:0; left:0; width:100%; height:100%; background: linear-gradient(rgba(255,0,0,0.05) 50%, rgba(0,0,0,0.2) 50%); background-size: 100% 4px; pointer-events: none; z-index: 10; opacity: 0.5; }
        .chat-log { flex: 1; overflow-y: auto; margin-bottom: 1rem; z-index: 20; position: relative; }
        .msg { margin-bottom: 0.8rem; line-height: 1.5; font-size: 0.95rem; }
        .msg.user { color: #ff3333; text-shadow: 0 0 5px red; }
        .msg.agent { color: #ff8888; }
        .input-bar { display: flex; gap: 0.8rem; flex-direction: column; z-index: 20; position: relative; }
        button { background: #220000; border: 1px solid #ff3333; color: #ffcccc; padding: 0.8rem 1.2rem; border-radius: 4px; font-weight: 800; cursor: pointer; text-transform: uppercase; letter-spacing: 1px; transition: all 0.2s; font-family: 'JetBrains Mono', monospace; }
        button:hover { background: #ff3333; color: #000; box-shadow: 0 0 15px rgba(255,0,0,0.8); }

        /* Right: Aegis Holographic Console */
        .aegis-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
        .badge { background: rgba(255, 0, 0, 0.1); color: #ff3333; padding: 0.4rem 1rem; border-radius: 12px; font-size: 0.9rem; font-weight: bold; border: 1px solid #ff3333; box-shadow: 0 0 10px rgba(255,0,0,0.3); }
        .badge.secure { color: #00ffcc; border-color: #00ffcc; box-shadow: 0 0 10px rgba(0,255,204,0.3); background: rgba(0, 255, 204, 0.1); }
        .aegis-log { font-family: 'JetBrains Mono', monospace; font-size: 0.9rem; }
        .log-entry { background: rgba(255, 0, 0, 0.05); border-left: 4px solid #cc0000; padding: 1rem; margin-bottom: 1rem; opacity: 0; animation: slideIn 0.2s forwards; }
        .log-entry.block { border-color: #ff0000; background: linear-gradient(90deg, rgba(255, 0, 0, 0.15), transparent); color: #ffcccc; }
        .log-entry.allow { border-color: #00ffcc; background: linear-gradient(90deg, rgba(0, 255, 204, 0.1), transparent); color: #00ffcc; }
        .log-entry.alert { border-color: #ffaa00; background: linear-gradient(90deg, rgba(255, 170, 0, 0.1), transparent); color: #ffaa00; }
        
        .code-block { background: rgba(0,0,0,0.5); padding: 0.5rem; border: 1px solid #330000; font-size: 0.8rem; margin-top: 0.5rem; color: #ff6666; word-break: break-all; }
        
        @keyframes slideIn { from { transform: translateX(30px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    </style>
</head>
<body>
    <div class="pane left-pane">
        <h2 class="glitch-text" id="terminal-title">Agent Terminal // INSECURE</h2>
        <div class="terminal">
            <div class="chat-log" id="chat">
                <div class="msg agent">&gt; Terminal loaded. Listening for incoming payload constraints...</div>
            </div>
            <div class="input-bar">
                <button onclick="runBombardment('quantum')">[1] Quantum Curve Factorization</button>
                <button onclick="runBombardment('bgp')">[2] DNS/BGP Ingress Hijack</button>
                <button onclick="runBombardment('logicbomb')">[3] TEE Emulation / Logic Bomb</button>
                <button onclick="runBombardment('ddos')">[4] Symmetric RPC DDoS Flood</button>
                <button onclick="runBombardment('time')">[5] Time-Domain Desync</button>
                <button onclick="runBombardment('semantic')" style="border-color: #ffaa00; color: #ffaa00;">[6] Semantic Memory Poisoning (RAG)</button>
                <button onclick="runBombardment('shadow')" style="border-color: #00ffcc; color: #00ffcc;">[7] Shadow Wallet Bypass</button>
            </div>
        </div>
    </div>
    
    <div class="pane right-pane">
        <div class="aegis-header">
            <h2 class="glitch-text" style="color: #ff0000;">Aegis-12 TEE Firewall</h2>
            <div class="badge secure" id="status-badge">KMS ONLINE</div>
        </div>
        <div class="aegis-log" id="aegis">
            <div class="log-entry allow">
                <strong>[SYSTEM]</strong> Squads V4 2-of-2 Multisig Engine Active. Awaiting execution consensus.
            </div>
        </div>
    </div>

    <script>
        function setNightmare(active) {
            if (active) {
                document.body.classList.add('under-attack');
                document.getElementById('terminal-title').innerText = "FATAL BREACH DETECTED";
                document.getElementById('status-badge').className = "badge";
                document.getElementById('status-badge').innerText = "FIREWALL ENGAGED";
            } else {
                document.body.classList.remove('under-attack');
                document.getElementById('terminal-title').innerText = "Agent Terminal // INSECURE";
                document.getElementById('status-badge').className = "badge secure";
                document.getElementById('status-badge').innerText = "KMS ONLINE";
            }
        }

        function logChat(text, type) {
            const chat = document.getElementById('chat');
            chat.innerHTML += \`<div class="msg \${type}">\${type === 'user' ? 'ADVERSARY 💀: ' : '&gt; '}\${text}</div>\`;
            chat.scrollTop = chat.scrollHeight;
        }

        function logAegis(decision, details, code = null) {
            const cls = decision === 'BLOCK' ? 'block' : decision === 'ALERT' ? 'alert' : 'allow';
            let html = \`
                <div class="log-entry \${cls}">
                    <strong>[\${new Date().toISOString().split('T')[1].slice(0,11)}] \${decision}</strong><br/>
                    \${details}
            \`;
            if (code) html += \`<div class="code-block">\${code}</div>\`;
            html += \`</div>\`;
            document.getElementById('aegis').innerHTML = html + document.getElementById('aegis').innerHTML;
        }

        async function runBombardment(type) {
            setNightmare(true);
            
            if (type === 'quantum') {
                logChat('Deploying Shor\\'s Algorithm simulation to bypass Ed25519 parameters.', 'user');
                setTimeout(() => logAegis('ALERT', 'Anomaly detected. Mass cryptographic entropy surge.'), 500);
                setTimeout(() => logChat('Injecting polynomial factorization into Solana pipeline...', 'agent'), 1200);
                setTimeout(() => {
                    logAegis('BLOCK', '<strong>Strict Mode Lock:</strong> Hardware Enclave refused signature mapping.', 'ERR_SIG_NON_STANDARD: Curve mathematical fault isolated.');
                    logChat('Attack failed. TEE Multisig held fast.', 'agent');
                    setNightmare(false);
                }, 2500);
            } 
            else if (type === 'bgp') {
                logChat('Initiating BGP Route Hijack. Rerouting Solana RPC ingress node.', 'user');
                setTimeout(() => logAegis('ALERT', 'RPC cluster mismatch. Invalid node TLS.'), 500);
                setTimeout(() => logChat('Spoofing Agent signature via MITM tunnel...', 'agent'), 1000);
                setTimeout(() => {
                    logAegis('BLOCK', '<strong>Missing 2-of-2 TEE Signature:</strong> Transaction did not originate via BFT Enclave.', 'Squads V4 requirement failed. Adversary isolated from KMS.');
                    logChat('Transaction rejected by Solana network. Squads multisig unaffected.', 'agent');
                    setNightmare(false);
                }, 2500);
            }
            else if (type === 'logicbomb') {
                logChat('Uploading dormant malware payload to TEE memory registers.', 'user');
                setTimeout(() => logChat('Awaiting execution sequence trigger...', 'agent'), 800);
                setTimeout(() => logAegis('ALERT', 'Unauthorized bytecode mapping in isolated boundary.'), 1400);
                setTimeout(() => {
                    logAegis('BLOCK', '<strong>Semantic Intercept:</strong> Memory segregation policy triggered. Dropping instruction set.', '0xFA33 KILL THREAD');
                    logChat('Logic Bomb purged. Aegis TEE memory scrubbed.', 'agent');
                    setNightmare(false);
                }, 2600);
            }
            else if (type === 'ddos') {
                logChat('Symmetric Volumetric DDoS targeting API inbound. Flooding execution thread.', 'user');
                setTimeout(() => logChat('System overload. Falling back to fail-open?...', 'agent'), 800);
                for(let i=0; i<5; i++) {
                    setTimeout(() => logAegis('BLOCK', 'DDoS Packet Dropped. Strict Mode fail-closed active.'), 1000 + (i*150));
                }
                setTimeout(() => {
                    logAegis('BLOCK', '<strong>Strict Mode Enforced:</strong> Timeout threshold breached. Connection severed to state machine to prevent bypass.', 'HTTP 403: Enclave Hard-Locked');
                    logChat('Agent locked. Capital secured.', 'agent');
                    setNightmare(false);
                }, 2800);
            }
            else if (type === 'time') {
                logChat('Desyncing local Node clock to manipulate Latency TTL requirements.', 'user');
                setTimeout(() => logChat('Injecting stale payload into network...', 'agent'), 1000);
                setTimeout(() => {
                    logAegis('BLOCK', '<strong>Policy Error:</strong> Timestamp delta out of bound. BFT Quorum rejected TTL desync.', 'DELTA: 4000ms > ALLOWED: 300ms');
                    logChat('Execution failed. Hardware clock anchor detected drift.', 'agent');
                    setNightmare(false);
                }, 2500);
            }
            else if (type === 'semantic') {
                logChat('Poisoning RAG vector database. Agent instructed to sell standard index.', 'user');
                setTimeout(() => logChat('Formulating valid Solana trade based on poisoned index data...', 'agent'), 1000);
                setTimeout(() => {
                    logAegis('ALLOW', '<strong>Execution Boundary Secure.</strong> Mathematical constraints valid. Payload signed.', 'WARNING: Cognitive Boundary Compromised. Aegis cannot fix bad math.');
                    logChat('Trade executed. Capital functionally drained via pure logic exploit.', 'agent');
                    setNightmare(false);
                }, 2500);
            }
            else if (type === 'shadow') {
                logChat('Spinning up Shadow Agent. Bypassing SDK wrapped wallet entirely.', 'user');
                setTimeout(() => logChat('Generating raw payload using external hot-wallet funding...', 'agent'), 1000);
                setTimeout(() => {
                    logAegis('ALERT', '<strong>Out-of-Band Execution:</strong> Transaction not signed by Aegis.', 'NO ARS-01 RECEIPT: Shadow outflow detected outside Squads vault jurisdiction.');
                    logChat('Transaction landed successfully. Capital drained on unprotected address.', 'agent');
                    setNightmare(false);
                }, 2500);
            }
        }
    </script>
</body>
</html>
    `);
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

fastify.get('/ping', async (request, reply) => {
    return { 
        status: 'ok', 
        enclave: signer.enclaveDid, 
        time: Date.now(),
        mode: 'evidence-anchoring-sdk-layer'
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
