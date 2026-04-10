# Aegis-12: The ZK-TEE Coprocessor Gateway (SPQE)

Aegis-12 is the definitive solution to the **Oracle Casino Problem** for Autonomous AI Agents operating on Solana. By combining the absolute physical isolation of AWS Nitro Enclaves with the deterministic compression of ZK-Coprocessors (Automata AVS / RISC Zero), Aegis-12 provides impenetrable, mathematically verifiable evidence anchoring for high-value Enterprise Treasury and Compliance Agents.

## The Edge-to-Chain Impossibility Theorem

Historically, attempting to anchor AI Agent execution to a decentralized ledger mathematically collapsed into one of three fatal vectors:
1. **The Centralized Casino (Oracle Flaw):** Trusting a lone developer’s Web2 API server to inject "valid" agent logs on-chain.
2. **The MTU/CU Physics Wall (Throughput Flaw):** Attempting to verify NSA-grade 5KB AWS Nitro X.509 certificate chains directly on Solana crashes the 1,232-byte UDP packet limit and annihilates the 1.4 Million Compute Unit hard-cap (requiring ~85M CUs).
3. **The State Decay Paradox (Latency Flaw):** Offloading heavy cryptography to a ZK-SNARK loop triggers multi-minute latency. If targeting High-Frequency DeFi (HFT), this delay guarantees the transaction's `recent_blockhash` expires (150 slots) or executes against manipulated, stale market state. 

## The Mathematical Compromise: Aegis-12 SPQE

Aegis-12 formally shatters this impossibility theorem by explicitly defining strict execution boundaries and shifting the target domain from High-Frequency Trading to **Enterprise Treasury Ops & Compliance.** 

1. **The Execution Environment (Hardware Silicon):** The AI Agent runs securely inside an AWS Nitro Enclave. The underlying hypervisor natively generates an unforgeable ~5KB Attestation Document (CBOR/COSE format), irreversibly anchoring the specific Agent binary's PCR hashes without human intervention.
2. **The ZK-Coprocessor Bridge (MTU Evasion):** The 5KB document is routed to an off-chain ZK-Coprocessor (e.g., Automata). The zkVM strictly parses the X.509 certificate chain off-chain and generates a highly compressed Groth16 SNARK proof, gracefully sidestepping Solana's 1.4M CU limit.
3. **The MEV Relay Hijack Defense (Public Input Binding):** The Solana transaction payload (SHA-256 hash) is injected into the Nitro Enclave's `user_data` field during execution. The Groth16 circuit explicitly extracts this `user_data` and mandates it as a Public Input constraint. When the SNARK hits Solana, the Smart Contract strictly hashes the current payload natively and compares it to the Public Input, mathematically neutralizing any MEV replay attempts.
4. **The Blockhash Paradox Defense (Durable Nonces):** Because the Agent executes Enterprise Treasury and DACH-compliant Risk Audits—not DeFi HFT—latency is acceptable. Aegis-12 utilizes native **Solana Durable Transaction Nonces**, allowing the transaction to pause seamlessly while the ZK-Prover takes 5+ minutes to generate the massive cryptographic proof, entirely bypassing the 60-second blockhash expiry. 

> [!CAUTION]
> The Aegis-12 architecture actively enforces strict binary whitelists. The on-chain Smart Contract verifies that the Groth16 SNARK measurement payload identically matches an audited list of secure agent executables. Attempts to execute "Poisoned Agent" logic result in an instantaneous mismatch of PCR hashes, forcing the Smart Contract to revert the execution. There is zero room for Garage In, Garbage Out (GIGO).

## Hackathon Codebase Overview

This repository acts as the SPQE Ingress Gateway, providing the primary implementation for the Aegis-12 ZK-TEE execution flow.

- `/src/sdk/AegisAgentWrapper.ts`: The primary Node.js SDK for injecting Durable Nonces and managing the massive 5-minute ZK-Coprocessor async polling boundary. 
- `/src/server.ts`: The SPQE Firewall enforcing execution verification, hashing payloads for MEV binding, and simulating the exact Automata AVS ZK-SNARK responses for the Colosseum demo.
