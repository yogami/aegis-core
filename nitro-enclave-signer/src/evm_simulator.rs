use ed25519_dalek::{Signer as _, SigningKey};
use serde_json::Value;

/// Simulates the construction of an EVM-compatible execution log
/// and signs it using the Enclave's cryptographic key.
pub fn generate_evm_attestation(
    signing_key: &SigningKey,
    agent_id: &str,
    tool_name: &str,
    tool_inputs: &Value,
) -> (String, String, String) {
    // Format specifically designed for the SPQEIntentRegistry.sol smart contract
    let tool_inputs_str = serde_json::to_string(tool_inputs).unwrap_or_default();
    
    // Create the exact message boundary required to be parsed by the Solidity contract
    let message = format!("EVM_ATTACHMENT_V1|{}|{}|{}", agent_id, tool_name, tool_inputs_str);
    
    let signature = signing_key.sign(message.as_bytes());
    let sig_hex = hex::encode(signature.to_bytes());

    // Generate arbitrary attestation PCR doc (Nitro simulation)
    // Real Nitro Enclaves would return a CBR-encoded CBOR attestation document here.
    let attestation_doc_hex = "f91223bc78abc9...nitro_pcr_doc_simulation_evm...".to_string();

    (sig_hex, message, attestation_doc_hex)
}
