use solana_sdk::transaction::Transaction;
use bincode;
use base64::{Engine as _, engine::general_purpose::STANDARD as base64_engine};
use tracing::{info, warn};
use serde_json::Value;

pub fn generate_svm_attestation(
    signer_key: &ed25519_dalek::SigningKey,
    agent_id: &str,
    tool_name: &str,
    tool_inputs: &Value,
) -> (String, String, String) {
    info!("Parsing SVM Transaction Intent natively...");

    // Extract base64 payload from tool inputs
    let tx_base64 = tool_inputs.get("tx_base64")
        .and_then(|val| val.as_str())
        .unwrap_or_default();

    if tx_base64.is_empty() {
        warn!("SVM Decoder: Missing tx_base64 field in payload");
        return (
            "ERROR_NO_PAYLOAD".to_string(),
            "".to_string(),
            "svm_decoder_error".to_string()
        );
    }

    // Decode base64
    let tx_bytes = match base64_engine.decode(tx_base64) {
        Ok(bytes) => bytes,
        Err(e) => {
            warn!("SVM Decoder: Invalid base64 - {}", e);
            return (
                "ERROR_INVALID_BASE64".to_string(),
                "".to_string(),
                "svm_decoder_error".to_string()
            );
        }
    };

    // Parse the Solana Transaction
    let transaction: Transaction = match bincode::deserialize(&tx_bytes) {
        Ok(tx) => tx,
        Err(e) => {
            warn!("SVM Decoder: Invalid solana transaction byte format - {}", e);
            return (
                "ERROR_INVALID_TX_FORMAT".to_string(),
                "".to_string(),
                "svm_decoder_error".to_string()
            );
        }
    };

    // Extract semantic meaning for attestations
    let mut num_instructions = 0;
    let mut programs = Vec::new();
    let message = &transaction.message;

    for ix in &message.instructions {
        num_instructions += 1;
        let program_id_index = ix.program_id_index as usize;
        if program_id_index < message.account_keys.len() {
            programs.push(message.account_keys[program_id_index].to_string());
        }
    }

    info!("SVM Decoder Success: Parsed {} instructions targeting programs: {:?}", num_instructions, programs);

    // Generate cryptographic attestation over the raw transaction hash
    let message_hash = message.hash();
    
    // We sign the message hash to act as a co-signer
    let signature = ed25519_dalek::Signer::sign(signer_key, message_hash.as_ref());

    (
        bs58::encode(signature.to_bytes()).into_string(),
        format!("Decoded tx: {} instructions, hash: {:?}", num_instructions, message_hash),
        "solana_native_enclave_signature".to_string(),
    )
}
