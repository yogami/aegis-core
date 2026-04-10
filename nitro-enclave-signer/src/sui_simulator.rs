use ed25519_dalek::{Signer as _, SigningKey};
use serde_json::Value;

/// Simulates the construction of a Sui-compatible execution log
/// and signs it using the Enclave's cryptographic key.
pub fn generate_sui_attestation(
    signing_key: &SigningKey,
    agent_id: &str,
    tool_name: &str,
    tool_inputs: &Value,
) -> (String, String, String) {
    // Format specifically designed for the Sui Move Smart Contract equivalents
    let tool_inputs_str = serde_json::to_string(tool_inputs).unwrap_or_default();
    
    // Create the exact message boundary representing Sui BCS serialization mockup
    let message = format!("SUI_MOVE_V1::{}::{}::{}", agent_id, tool_name, tool_inputs_str);
    
    let signature = signing_key.sign(message.as_bytes());
    let sig_hex = hex::encode(signature.to_bytes());

    // Generate arbitrary attestation PCR doc (Nitro simulation)
    let attestation_doc_hex = "0x78ab22c9...nitro_pcr_doc_simulation_sui...".to_string();

    (sig_hex, message, attestation_doc_hex)
}
