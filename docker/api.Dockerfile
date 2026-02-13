# Stage 1: Install Compact Compiler
FROM ubuntu:24.04 AS contract-builder

RUN apt-get update && \
    apt-get install -y curl ca-certificates \
    xz-utils tar unzip && \
    rm -rf /var/lib/apt/lists/*

RUN curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/download/compact-v0.4.0/compact-installer.sh | sh

ENV PATH="/root/.local/bin:${PATH}"

WORKDIR /app

COPY packages/contract ./packages/contract

WORKDIR /app/packages/contract

RUN compact update
RUN compact compile ./compact/Main.compact ./managed

# Stage 2: Copy in api code and compiled contract artifacts then install and run.
FROM oven/bun:1.3.9-alpine

WORKDIR /app

COPY bun.lock package.json ./
COPY packages ./packages

COPY --from=contract-builder /app/packages/contract/managed ./packages/contract/managed

RUN bun install --ci --production

ENV NODE_ENV=production
ENV PORT=8787

EXPOSE 8787

CMD ["bun", "packages/api/index.ts"]