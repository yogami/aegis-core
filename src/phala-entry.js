"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = phalaEntrypoint;
const AegisPEP_1 = require("./infrastructure/AegisPEP");
const AegisSigner_1 = require("./infrastructure/AegisSigner");
// The TEE generates a secure in-memory keypair upon instantiation that never leaves the hardware.
// In a full Phala Phat Contract, this can be derived deterministically from the enclave's root key.
const signer = new AegisSigner_1.AegisSigner();
const pep = new AegisPEP_1.AegisPEP(signer);
/**
 * Main entrypoint for the Phala Network JS Enclave.
 * This function handles incoming execution requests from NoahAI agents.
 */
async function phalaEntrypoint(requestPayload) {
    try {
        const payload = JSON.parse(requestPayload);
        // 1. Evaluate the action through the Hardware PEP
        const receipt = await pep.enforce(payload);
        // We use AbortSignal to handle the timeout cleanly in Node 20
        let attestation = "LOCAL_MOCK_ATTESTATION";
        try {
            // The Phala dstack CVM exposes a local API for the enclave to request its own hardware quote
            // This is only accessible from inside the TEE itself.
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 1000);
            const attestationResponse = await fetch('http://127.0.0.1:8090/quote', { signal: controller.signal });
            clearTimeout(timeoutId);
            if (attestationResponse.ok) {
                const data = await attestationResponse.json();
                attestation = data.quote;
            }
        }
        catch (err) {
            console.warn("[Aegis TEE] Fetching dstack attestation failed. Running in unprotected mock mode.");
        }
        // 2. Return cryptographically signed receipt + mock attestation
        return JSON.stringify({
            status: "approved",
            receipt,
            enclaveDid: signer.enclaveDid,
            // In a production Phala deployment, the host injects the real quote here:
            attestation,
            message: "Action approved by Aegis Hardware Enclave."
        });
    }
    catch (e) {
        // TERMINAL REFUSAL
        // The hardware enclave explicitly denied the action.
        return JSON.stringify({
            status: "denied",
            error: e.message,
            enclaveDid: signer.enclaveDid,
            message: "Aegis Hardware Enclave blocked this transaction due to policy violation."
        });
    }
}
