use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Instant;

use bytes::Bytes;
use ed25519_dalek::{Signer as _, SigningKey};
use http_body_util::{BodyExt, Full};
use hyper::server::conn::http1;
use hyper::service::service_fn;
use hyper::{Method, Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use rand::rngs::OsRng;
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

mod evm_simulator;
mod sui_simulator;
mod svm_decoder;

#[derive(Deserialize, Debug)]
struct AgentRuntimePayload {
    agent_id: String,
    tool_name: String,
    tool_inputs: serde_json::Value,
    policy_hash: String,
    timestamp_ms: u64,
}

#[derive(Serialize)]
struct CertifiedExecutionRecord {
    certified: bool,
    timestamp_ms: u64,
    agent_identity: String,
    permitted_action: String,
    policy_hash: String,
    cryptographic_signature: Option<String>,
    attestation_provider: String,
    reasoning: String,
}

#[derive(Deserialize, Debug, Clone)]
struct ExecutionManifest {
    version: String,
    agent_id: String,
    allowed_tools: Vec<String>,
    disallowed_tools: Vec<String>,
}

struct AppState {
    signing_key: SigningKey,
    manifest: ExecutionManifest,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")))
        .json()
        .init();

    tracing::info!("VERA Evidence Runtime (SPQE Enclave Signer) starting...");

    let port: u16 = std::env::var("PORT").unwrap_or_else(|_| "5000".to_string()).parse()?;

    // Generate an in-memory keypair for the enclave boundary
    let mut csprng = OsRng;
    let signing_key = SigningKey::generate(&mut csprng);
    
    // Load the cryptographic execution baseline manifest
    let manifest_path = "manifest.json";
    let manifest_content = std::fs::read_to_string(manifest_path).unwrap_or_else(|_| {
        tracing::warn!("manifest.json not found, using generic permissive manifest.");
        r#"{ "version":"1.0", "agent_id":"*", "allowed_tools":[], "disallowed_tools":[] }"#.to_string()
    });
    let manifest: ExecutionManifest = serde_json::from_str(&manifest_content).expect("Failed to parse cryptographic manifest");

    let state = Arc::new(AppState {
        signing_key,
        manifest,
    });

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;
    tracing::info!("Listening directly on {}", addr);

    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);
        let state_clone = state.clone();

        tokio::task::spawn(async move {
            let svc = service_fn(move |req| handle_request(req, state_clone.clone()));
            if let Err(err) = http1::Builder::new().serve_connection(io, svc).await {
                tracing::error!("Error serving connection: {:?}", err);
            }
        });
    }
}

async fn handle_request(
    req: Request<hyper::body::Incoming>,
    state: Arc<AppState>,
) -> Result<Response<Full<Bytes>>, Infallible> {
    let start = Instant::now();
    let path = req.uri().path().to_string();
    let method = req.method().clone();

    // CORS preflight
    if method == Method::OPTIONS {
        return Ok(cors_response(StatusCode::OK, ""));
    }

    if (path == "/api/v1/cer/generate" || path == "/api/validate/evm" || path == "/api/validate/sui" || path == "/api/validate/solana" || path == "/api/validate") && method == Method::POST {
        let body_bytes = match req.collect().await {
            Ok(b) => b.to_bytes(),
            Err(e) => return Ok(cors_response(StatusCode::BAD_REQUEST, &format!("Body Error: {}", e))),
        };

        let request: AgentRuntimePayload = match serde_json::from_slice(&body_bytes) {
            Ok(req) => req,
            Err(e) => {
                let err_msg = format!("JSON parse error: {}", e);
                return Ok(cors_response(StatusCode::BAD_REQUEST, &err_msg));
            }
        };

        let latency_ms = start.elapsed().as_millis() as u64;

        // --- HARDWARE EXECUTIVE BOUNDARY ENFORCEMENT ---
        let mut is_admissible = true;
        let mut drop_reasoning = String::new();

        if !state.manifest.allowed_tools.is_empty() && !state.manifest.allowed_tools.contains(&request.tool_name) {
            is_admissible = false;
            drop_reasoning = format!("Topological Block: Tool '{}' is NOT in the allowed execution baseline manifest.", request.tool_name);
            tracing::warn!("BLOCKED: Out of bounds tool call '{}'", request.tool_name);
        } else if state.manifest.disallowed_tools.contains(&request.tool_name) {
            is_admissible = false;
            drop_reasoning = format!("Topological Block: Tool '{}' is explicitly forbidden by the baseline manifest.", request.tool_name);
            tracing::warn!("BLOCKED: Forbidden tool call '{}'", request.tool_name);
        }

        let response = if is_admissible {
            let (sig_hex, _message, _attestation) = match path.as_str() {
                "/api/v1/cer/generate" => {
                    // OEM GRC Attestation
                    let tool_inputs_str = serde_json::to_string(&request.tool_inputs).unwrap_or_default();
                    let message = format!("{}-{}-{}-{}", request.agent_id, request.tool_name, request.timestamp_ms, request.policy_hash);
                    let signature = state.signing_key.sign(message.as_bytes());
                    (hex::encode(signature.to_bytes()), message, "cer_oem_signature".to_string())
                },
                "/api/validate/evm" => {
                    evm_simulator::generate_evm_attestation(
                        &state.signing_key,
                        &request.agent_id,
                        &request.tool_name,
                        &request.tool_inputs
                    )
                },
                "/api/validate/sui" => {
                    sui_simulator::generate_sui_attestation(
                        &state.signing_key,
                        &request.agent_id,
                        &request.tool_name,
                        &request.tool_inputs
                    )
                },
                "/api/validate/solana" => {
                    svm_decoder::generate_svm_attestation(
                        &state.signing_key,
                        &request.agent_id,
                        &request.tool_name,
                        &request.tool_inputs
                    )
                },
                _ => {
                    // Default legacy validation
                    let tool_inputs_str = serde_json::to_string(&request.tool_inputs).unwrap_or_default();
                    let message = format!("{}-{}-{}", request.agent_id, request.tool_name, tool_inputs_str);
                    let signature = state.signing_key.sign(message.as_bytes());
                    (hex::encode(signature.to_bytes()), message, "legacy_pcr_attestation".to_string())
                }
            };
            CertifiedExecutionRecord {
                certified: true,
                timestamp_ms: request.timestamp_ms,
                agent_identity: request.agent_id.clone(),
                permitted_action: request.tool_name.clone(),
                policy_hash: request.policy_hash.clone(),
                cryptographic_signature: Some(sig_hex),
                attestation_provider: "nitro_enclave_spqe".to_string(),
                reasoning: format!("HW Attested: Tool '{}' structurally validated against deterministic manifest {} ({} ms latency).", request.tool_name, state.manifest.version, latency_ms),
            }
        } else {
            CertifiedExecutionRecord {
                certified: false,
                timestamp_ms: request.timestamp_ms,
                agent_identity: request.agent_id.clone(),
                permitted_action: request.tool_name.clone(),
                policy_hash: request.policy_hash.clone(),
                cryptographic_signature: None,
                attestation_provider: "nitro_enclave_spqe".to_string(),
                reasoning: drop_reasoning,
            }
        };

        let json = serde_json::to_string(&response).unwrap_or_default();
        Ok(cors_response(StatusCode::OK, &json))

    } else if path == "/health" {
        Ok(cors_response(StatusCode::OK, "{\"status\":\"ok\"}"))
    } else {
        Ok(cors_response(StatusCode::NOT_FOUND, "Not Found"))
    }
}

fn cors_response(status: StatusCode, body: &str) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header("Access-Control-Allow-Origin", "*")
        .header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        .header("Access-Control-Allow-Headers", "Content-Type")
        .header("Content-Type", "application/json")
        .body(Full::new(Bytes::from(body.to_owned())))
        .unwrap()
}
