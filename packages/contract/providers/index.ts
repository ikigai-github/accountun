import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";

import type { CircuitKeys, MidnightConfig, Providers, Wallet } from "../types";

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createWalletProvider } from "./wallet-provider";
import { createSqlitePrivateStateProvider } from "./sqlite-state-provider";

/**
 * Wraps the creation of all the providers needed to interact with midnight
 * @param config configuration for connecting to midnight
 * @param wallet the started wallet instance to create the providers with
 * @returns all the providers needed to interact with midnight
 */
export async function createProviders(
  config: MidnightConfig,
  wallet: Wallet,
): Promise<Providers> {
  const privateStateProvider = createSqlitePrivateStateProvider(config);

  const publicDataProvider = indexerPublicDataProvider(
    config.indexerHttpUri,
    config.indexerWsUri,
  );

  const moduleUrl = path.dirname(fileURLToPath(import.meta.url));
  const contractsDir = path.join(moduleUrl, "..", "managed");
  const zkConfigProvider = new NodeZkConfigProvider<CircuitKeys>(contractsDir);

  const proofProvider = httpClientProofProvider(config.proofServerUri);

  const walletProvider = await createWalletProvider(wallet);

  return {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider,
    proofProvider,
    walletProvider,
    midnightProvider: walletProvider,
  };
}
