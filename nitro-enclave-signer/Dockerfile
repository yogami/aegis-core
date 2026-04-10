FROM rust:1.80 as builder

WORKDIR /usr/src/spqe
COPY . .

# Prevent memory exhaustion on Railway free tier
ENV CARGO_BUILD_JOBS=1
ENV CARGO_NET_GIT_FETCH_WITH_CLI=true

RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/src/spqe/target/release/nitro-enclave-signer /usr/local/bin/spqe-enclave

ENV PORT=5000
EXPOSE 5000

CMD ["spqe-enclave"]
