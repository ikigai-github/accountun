import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MidnightConfig } from "../../types";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export function buildIntegrationConfig(seedHex: string): MidnightConfig {
  return {
    cacheDir: path.join(packageDir, ".cache", "integration"),
    authSecret: new Uint8Array(16).fill(7),
    serviceWalletSeedHex: seedHex,
    network: (process.env.NETWORK ?? "undeployed") as MidnightConfig["network"],
    substrateNodeUri: process.env.SUBSTRATE_NODE_URI ?? "http://127.0.0.1:9944",
    indexerHttpUri:
      process.env.INDEXER_HTTP_URI ?? "http://127.0.0.1:8088/api/v3/graphql",
    indexerWsUri:
      process.env.INDEXER_WS_URI ?? "ws://127.0.0.1:8088/api/v3/graphql/ws",
    proofServerUri: process.env.PROOF_SERVER_URI ?? "http://127.0.0.1:6300",
  };
}
