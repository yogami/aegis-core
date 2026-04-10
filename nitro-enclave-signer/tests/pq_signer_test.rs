// ATDD Spec: Post-Quantum Signer (ML-DSA via liboqs)
//
// Tests the ML-DSA-65 signing implementation:
// - Key generation
// - Sign/verify roundtrip
// - Invalid signature rejection
// - Nonce pre-computation for speculative path

#[cfg(test)]
mod tests {
    use crate::domain::pq_signer::PQSigner;

    /// AC-1: Key generation produces a valid keypair.
    #[test]
    fn keygen_produces_valid_keypair() {
        let signer = PQSigner::new().expect("PQSigner should initialize");
        let (pk, sk) = signer.keypair();
        assert!(!pk.is_empty(), "Public key should not be empty");
        assert!(!sk.is_empty(), "Secret key should not be empty");
        // ML-DSA-65 public key is 1952 bytes
        assert!(pk.len() > 100, "PQ public key should be substantial");
    }

    /// AC-2: Sign/verify roundtrip succeeds.
    #[test]
    fn sign_verify_roundtrip() {
        let signer = PQSigner::new().expect("PQSigner should initialize");
        let message = b"transfer 1000 lamports to 9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin";

        let signature = signer.sign(message).expect("Signing should succeed");
        let valid = signer.verify(message, &signature);
        assert!(valid.is_ok(), "Verification should succeed for valid signature");
    }

    /// AC-3: Invalid signature is rejected.
    #[test]
    fn invalid_signature_rejected() {
        let signer = PQSigner::new().expect("PQSigner should initialize");
        let message = b"legitimate transaction";
        let tampered_sig = vec![0xFF; 100]; // garbage signature

        let result = signer.verify(message, &tampered_sig);
        assert!(result.is_err(), "Tampered signature should be rejected");
    }

    /// AC-4: Different messages produce different signatures.
    #[test]
    fn different_messages_different_signatures() {
        let signer = PQSigner::new().expect("PQSigner should initialize");
        let sig1 = signer.sign(b"message one").expect("Sign should succeed");
        let sig2 = signer.sign(b"message two").expect("Sign should succeed");
        assert_ne!(sig1, sig2, "Different messages should produce different signatures");
    }

    /// AC-5: Nonce pre-computation returns usable nonce data.
    #[test]
    fn nonce_precomputation_returns_data() {
        let signer = PQSigner::new().expect("PQSigner should initialize");
        let message = b"speculative signing payload";
        let nonces = signer.precompute_nonces(message).expect("Nonce precomputation should succeed");
        assert!(!nonces.is_empty(), "Nonces should not be empty");
    }

    /// AC-6: Finalize with pre-computed nonces produces valid signature.
    #[test]
    fn finalize_with_nonces_produces_valid_sig() {
        let signer = PQSigner::new().expect("PQSigner should initialize");
        let message = b"speculative signing payload";

        let nonces = signer.precompute_nonces(message).expect("Nonce precomputation should succeed");
        let signature = signer
            .finalize_with_nonces(message, &nonces)
            .expect("Finalize should succeed");

        let valid = signer.verify(message, &signature);
        assert!(valid.is_ok(), "Signature from finalized nonces should verify");
    }
}
