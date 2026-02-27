import * as nacl from 'tweetnacl';

function hexToBytes(hex: string): Uint8Array {
    return new Uint8Array(Buffer.from(hex, 'hex'));
}

function bytesToHex(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString('hex');
}

export class AegisSigner {
    private privateKey: Uint8Array;
    private publicKey: Uint8Array;
    public readonly enclaveDid: string;

    constructor(privateKeyHex?: string, enclaveDid?: string) {
        if (privateKeyHex) {
            this.privateKey = hexToBytes(privateKeyHex);
            const keyPair = nacl.sign.keyPair.fromSecretKey(this.privateKey);
            this.publicKey = keyPair.publicKey;
        } else {
            const keyPair = nacl.sign.keyPair();
            this.privateKey = keyPair.secretKey;
            this.publicKey = keyPair.publicKey;
        }
        this.enclaveDid = enclaveDid || `did:aegis:enclave:${bytesToHex(this.publicKey).substring(0, 16)}`;
    }

    public getPublicKeyHex(): string {
        return bytesToHex(this.publicKey);
    }

    public sign(message: string): string {
        const messageBytes = new TextEncoder().encode(message);
        const signedBytes = nacl.sign.detached(messageBytes, this.privateKey);
        return bytesToHex(signedBytes);
    }

    public verify(message: string, signatureHex: string, publicKeyHex: string): boolean {
        const messageBytes = new TextEncoder().encode(message);
        const signatureBytes = hexToBytes(signatureHex);
        const publicKeyBytes = hexToBytes(publicKeyHex);
        return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    }
}
