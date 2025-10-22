import { bytes16FromHex, isHex32 } from "@accountun/common";
import type { MidnightConfig, NetworkName } from "./types";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Subset of MidnightConfig containing only the uris for midnight services parameters
 */
type MidnightServiceUris = Pick<
  MidnightConfig,
  "substrateNodeUri" | "indexerHttpUri" | "indexerWsUri" | "proofServerUri"
>;

/**
 * Returns the default configuration for connecting to a local Midnight node.
 * @returns The default configuration for connecting to a local Midnight node, proof server, and indexer.
 */
function getLocalServiceUris(): MidnightServiceUris {
  const substrateNodeUri = "http://127.0.0.1:9944";
  const indexerHttpUri = "http://127.0.0.1:8088/api/v1/graphql";
  const indexerWsUri = "ws://127.0.0.1:8088/api/v1/graphql/ws";
  const proofServerUri = "http://127.0.0.1:6300";

  return {
    indexerHttpUri,
    indexerWsUri,
    substrateNodeUri,
    proofServerUri,
  };
}

/**
 * Returns the default configuration for connecting to the Midnight testnet.
 * @returns The default testnet configuration
 */
function getTestnetServiceUris(): MidnightServiceUris {
  const substrateNodeUri = "https://rpc.testnet-02.midnight.network";
  const indexerHttpUri =
    "https://indexer.testnet-02.midnight.network/api/v1/graphql";
  const indexerWsUri =
    "wss://indexer.testnet-02.midnight.network/api/v1/graphql/ws";
  const proofServerUri = "http://127.0.0.1:6300";

  return {
    substrateNodeUri,
    indexerHttpUri,
    indexerWsUri,
    proofServerUri,
  };
}

/**
 * Checks that the AUTH_SECRET_HEX environment variable is set and is a valid 32-byte hex string then returns it.
 * @returns The authentication secret as a 32-byte Uint8Array
 */
function getAuthSecret(): Uint8Array {
  if (!process.env.AUTH_SECRET_HEX) {
    throw new Error("AUTH_SECRET_HEX is not set");
  }

  return bytes16FromHex(process.env.AUTH_SECRET_HEX);
}

/**
 * Checks if the AUTH_REPLACEMENT_KEY_HEX environment variable is set and is a valid 32-byte hex string then returns it.
 * @returns The optional replacement key for the auth secret, or undefined if not set
 */
function getAuthReplacementKey(): Uint8Array | undefined {
  return process.env.AUTH_REPLACEMENT_KEY_HEX
    ? bytes16FromHex(process.env.AUTH_REPLACEMENT_KEY_HEX)
    : undefined;
}

/**
 * Checks that the SERVICE_WALLET_SEED_HEX environment variable is set and is a valid 32-byte hex string then returns it.
 * @returns The service wallet seed as a 32-byte hex string
 */
function getServiceWalletSeed(): string {
  if (
    !process.env.SERVICE_WALLET_SEED_HEX ||
    !isHex32(process.env.SERVICE_WALLET_SEED_HEX)
  ) {
    throw new Error("SERVICE_WALLET_SEED_HEX is not a 32-byte hex string");
  }

  return process.env.SERVICE_WALLET_SEED_HEX;
}

/**
 * Gets the path to the cache directory. Defaults to ".cache" in the root directory of the project.
 * @returns The path to the cache directory, either from CACHE_PATH env var or defaulting to root directory .cache
 */
function getCachePath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const packageDir = path.dirname(moduleDir);
  const rootDir = path.dirname(packageDir);

  return process.env.CACHE_PATH || path.join(rootDir, ".cache");
}

/**
 * Type guard to check if a string is a valid NetworkName
 * @param name the name to check
 * @returns the name if it is a valid network name
 */
function isNetwork(name: string): name is NetworkName {
  return ["mainnet", "testnet", "devnet", "undeployed"].includes(
    name.toLowerCase(),
  );
}

/**
 * Reads the NETWORK environment variable and returns the corresponding network name.
 * @returns the network name to use (mainnet, testnet, devnet, undeployed)
 */
function getNetwork(): NetworkName {
  const network = process.env.NETWORK ? process.env.NETWORK : "testnet";
  if (!isNetwork(network)) {
    throw new Error(`Invalid network: ${network}`);
  }
  return network;
}

/**
 * Reads configuration from environment variables. Falls back to defaults if
 * environment variables are not set for non-critical values.  If NETWORK_MODE
 * is set to "local", will use local service uris, otherwise will use testnet
 * service uris.
 * @returns The complete configuration for connecting to midnight
 */
export function getConfig(): MidnightConfig {
  const cacheDir = getCachePath();
  const serviceWalletSeedHex = getServiceWalletSeed();
  const authSecret = getAuthSecret();
  const authReplacementKey = getAuthReplacementKey();
  const defaultServiceUris =
    process.env.NETWORK_MODE === "local"
      ? getLocalServiceUris()
      : getTestnetServiceUris();
  const substrateNodeUri =
    process.env.SUBSTRATE_NODE_URI || defaultServiceUris.substrateNodeUri;
  const indexerHttpUri =
    process.env.INDEXER_HTTP_URI || defaultServiceUris.indexerHttpUri;
  const indexerWsUri =
    process.env.INDEXER_WS_URI || defaultServiceUris.indexerWsUri;
  const proofServerUri =
    process.env.PROOF_SERVER_URI || defaultServiceUris.proofServerUri;
  const network = getNetwork();

  return {
    cacheDir,
    authSecret,
    authReplacementKey,
    serviceWalletSeedHex,
    substrateNodeUri,
    indexerHttpUri,
    indexerWsUri,
    proofServerUri,
    network,
  };
}
