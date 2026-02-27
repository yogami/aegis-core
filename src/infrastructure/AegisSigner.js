"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AegisSigner = void 0;
const nacl = __importStar(require("tweetnacl"));
function hexToBytes(hex) {
    return new Uint8Array(Buffer.from(hex, 'hex'));
}
function bytesToHex(bytes) {
    return Buffer.from(bytes).toString('hex');
}
class AegisSigner {
    privateKey;
    publicKey;
    enclaveDid;
    constructor(privateKeyHex, enclaveDid) {
        if (privateKeyHex) {
            this.privateKey = hexToBytes(privateKeyHex);
            const keyPair = nacl.sign.keyPair.fromSecretKey(this.privateKey);
            this.publicKey = keyPair.publicKey;
        }
        else {
            const keyPair = nacl.sign.keyPair();
            this.privateKey = keyPair.secretKey;
            this.publicKey = keyPair.publicKey;
        }
        this.enclaveDid = enclaveDid || `did:aegis:enclave:${bytesToHex(this.publicKey).substring(0, 16)}`;
    }
    getPublicKeyHex() {
        return bytesToHex(this.publicKey);
    }
    sign(message) {
        const messageBytes = new TextEncoder().encode(message);
        const signedBytes = nacl.sign.detached(messageBytes, this.privateKey);
        return bytesToHex(signedBytes);
    }
    verify(message, signatureHex, publicKeyHex) {
        const messageBytes = new TextEncoder().encode(message);
        const signatureBytes = hexToBytes(signatureHex);
        const publicKeyBytes = hexToBytes(publicKeyHex);
        return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    }
}
exports.AegisSigner = AegisSigner;
