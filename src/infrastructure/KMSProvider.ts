import { Keypair } from '@solana/web3.js';
import { AegisSigner } from './AegisSigner';

/**
 * Enterprise Key Management System (KMS) Stub.
 * 
 * In a production institutional setup, raw private keys must never touch the core
 * API backend's memory space, nor be loaded via .env. Operations like multi-sig 
 * signing must be delegated to isolated hardware (AWS KMS, HashiCorp Vault, or Intel TDX TEE).
 * 
 * This stub acts as the architectural boundary for Hackathon demonstration purposes.
 * Under the hood, it loads the legacy AegisSigner to sign Solana transactions,
 * but exposes an asynchronous layout that mirrors a remote secure enclave call.
 */
export class KMSProvider {
    private localSignerFallback: AegisSigner;
    public readonly enclaveDid: string;

    constructor() {
        // Loads from .env transparently in local setup, but abstracts it
        this.localSignerFallback = new AegisSigner(process.env.KMS_PRIVATE_KEY_HEX);
        this.enclaveDid = this.localSignerFallback.enclaveDid;
    }

    /**
     * Simulates fetching the public key from the remote hardware.
     */
    public async getPublicKeyHex(): Promise<string> {
        return this.localSignerFallback.getPublicKeyHex();
    }

    /**
     * Retrieves the Solana Web3 Keypair.
     * WARNING: Only exposed for legacy SDKs that require local raw serialization.
     * In an ideal Vault, this would throw and force remote signing.
     */
    public async getKeypair(): Promise<Keypair> {
        return this.localSignerFallback.getKeypair();
    }

    /**
     * Mock async payload signature over a network boundary.
     */
    public async signPayloadRemotely(message: string): Promise<string> {
        // Simulate network hop latency to HSM enclave
        await new Promise(resolve => setTimeout(resolve, 30));
        return this.localSignerFallback.sign(message);
    }
}
