import { NetworkId } from "@midnight-ntwrk/zswap";
import path from "node:path";

type NetworkName = "testnet" | "devnet" | "mainnet" | "undeployed";

type Config = {
  readonly WALLET_STATE_PATH: string;
  readonly SUBSTRATE_NODE_URI: string;
  readonly INDEXER_HTTP_URI: string;
  readonly INDEXER_WS_URI: string;
  readonly PROOF_SERVER_URI: string;
  readonly SERVICE_WALLET_SEED_HEX: string; // 32-byte hex, no 0x
  readonly AUTH_SECRET_HEX: string; // 32-byte hex, no 0x
  readonly NETWORK: NetworkName;
};

export const CONFIG: Config = {
  WALLET_STATE_PATH:
    process.env.SERVICE_WALLET_STATE_PATH ??
    path.resolve(process.cwd(), ".service-wallet.state"),

  SUBSTRATE_NODE_URI:
    process.env.SUBSTRATE_NODE_URI ?? "https://rpc.testnet-02.midnight.network",
  INDEXER_HTTP_URI:
    process.env.INDEXER_HTTP_URI ??
    "https://indexer.testnet-02.midnight.network/api/v1/graphql",
  INDEXER_WS_URI:
    process.env.INDEXER_WS_URI ??
    "wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws",
  PROOF_SERVER_URI: process.env.PROOF_SERVER_URI ?? "http://127.0.0.1:6300",
  SERVICE_WALLET_SEED_HEX: process.env.SERVICE_WALLET_SEED_HEX ?? "",
  AUTH_SECRET_HEX: process.env.AUTH_SECRET_HEX ?? "",
  NETWORK: (process.env.NETWORK as NetworkName) ?? "testnet",
} as const;

export function networkNameToId(name: NetworkName): NetworkId {
  switch (name) {
    case "mainnet":
      return NetworkId.MainNet;
    case "undeployed":
      return NetworkId.Undeployed;
    case "devnet":
      return NetworkId.DevNet;
    case "testnet":
    default:
      return NetworkId.TestNet;
  }
}
