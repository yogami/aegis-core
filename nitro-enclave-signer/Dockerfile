# Stage 1: Build the Rust BPF Simulator binary
FROM rust:1.76-slim-bullseye AS builder

WORKDIR /usr/src/app

# Install system dependencies required for Solana cryptographic crates and hardware attestation
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    build-essential \
    clang \
    cmake \
    git \
 && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
# Create dummy src file to cache dependencies
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release
RUN rm src/main.rs

COPY src ./src
COPY manifest.json ./manifest.json

# Build the true binary ensuring it binds efficiently to the remote DStack socket requirements
RUN cargo build --release

# Stage 2: Create the minimal secure runtime container for the TEE Hardware
FROM debian:bullseye-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    ca-certificates \
    libssl1.1 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/src/app/target/release/nitro-enclave-signer /usr/local/bin/aegis-enclave
COPY --from=builder /usr/src/app/manifest.json /app/manifest.json

# By strict Council security mandate, we expose NO SSH ports. 
# Only the secure HTTP tunnel mapped out to the DStack macro-orchestrator.
EXPOSE 5000

ENV PORT=5000
ENV RUST_LOG=info

# Run the raw binary
CMD ["aegis-enclave"]
