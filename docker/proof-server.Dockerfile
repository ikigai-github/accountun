# 1. pre-fetch zk-SNARK parameters to bake into the image
FROM oven/bun:1.3.3-alpine AS zk-builder

WORKDIR /app

COPY scripts ./scripts

ENV CIRCUIT_PARAM_RANGE="10 11 12 13 14 15 16 17"
ENV ZK_PARAMS_DIR="/zk-params"

RUN bun scripts/fetch-zk-params.ts

# 2. build the proof server image with the pre-fetched parameters
FROM midnightntwrk/proof-server:7.0.0

COPY --from=zk-builder /zk-params /.cache/midnight/zk-params

ENV RUST_LOG=trace
ENV RUST_BACKTRACE=full

CMD ["midnight-proof-server", "-v"]
