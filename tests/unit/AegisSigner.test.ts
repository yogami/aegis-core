import { describe, it, expect } from 'vitest';
import { AegisSigner } from '../../src/infrastructure/AegisSigner';

describe('AegisSigner', () => {
    it('should generate a new keypair if no private key is provided', () => {
        const signer = new AegisSigner();
        expect(signer.getPublicKeyHex()).toBeDefined();
        expect(signer.getPublicKeyHex().length).toBeGreaterThan(0);
        expect(signer.enclaveDid).toMatch(/^did:aegis:enclave:/);
    });

    it('should restore from an existing private key payload', () => {
        // Create an initial signer to generate keys
        const initialSigner = new AegisSigner();
        // Since we don't expose privateKey directly for security, we can't extract it easily, 
        // since tweetnacl expects a 64-byte secretKey representing the Ed25519 keypair:
        const dummyPrivateKeyHex = '00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';

        const restoredSigner = new AegisSigner(dummyPrivateKeyHex);
        expect(restoredSigner.getPublicKeyHex()).toBeDefined();
    });

    it('should consistently sign and verify a message', () => {
        const signer = new AegisSigner();
        const message = 'validate_transaction_50000';

        const signature = signer.sign(message);
        const pubKey = signer.getPublicKeyHex();

        expect(signature).toBeDefined();

        // Verifying with the same message and correct key
        const isValid = signer.verify(message, signature, pubKey);
        expect(isValid).toBe(true);
    });

    it('should reject verification if message is altered', () => {
        const signer = new AegisSigner();
        const signature = signer.sign('original_message');

        const isForgedValid = signer.verify('tampered_message', signature, signer.getPublicKeyHex());
        expect(isForgedValid).toBe(false);
    });

    it('should reject verification if signed by a different key', () => {
        const signer1 = new AegisSigner();
        const signer2 = new AegisSigner();

        const signature1 = signer1.sign('message');

        // Attempting to verify signer1's signature using signer2's public key
        const isMisattributedValid = signer1.verify('message', signature1, signer2.getPublicKeyHex());
        expect(isMisattributedValid).toBe(false);
    });
});
