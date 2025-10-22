import type { MidnightClient } from "@accountun/contract";
import { initializeClient } from "@accountun/contract/client";
import { joinContract, type DeployedContract } from "@accountun/contract";
import { saveWallet } from "@accountun/contract/wallet";

let client: MidnightClient | null = null;
let deployed: DeployedContract | null = null;

let initializing: Promise<MidnightClient> | null = null;
let joining: Promise<DeployedContract> | null = null;

const MIN_DELAY_MS = 500;
const MAX_DELAY_MS = 8000;

/**
 * Initialize the midnight client with retry to handle transient failures while api is running
 * @returns Connected midnight client
 */
async function initClient(): Promise<MidnightClient> {
  let delay = MIN_DELAY_MS;
  while (true) {
    try {
      return await initializeClient();
    } catch (error: unknown) {
      console.error("[midnight] initClient failed, retrying:", error);
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(MAX_DELAY_MS, delay * 2);
    }
  }
}

/**
 * Get the connected midnight client singleton.
 * @returns The currently connected midnight client
 */
export async function getClient(): Promise<MidnightClient> {
  if (client) return client;
  if (!initializing)
    initializing = initClient().then(
      (initializeClient) => (client = initializeClient),
    );
  try {
    return await initializing;
  } finally {
    initializing = null;
  }
}

/**
 * Uses the midnight client to join and return the deployed contract singleton.
 * @returns The found and joined deployed contract
 */
export async function getContract(): Promise<DeployedContract> {
  if (deployed) return deployed;
  if (!joining)
    joining = (async () => {
      const client = await getClient();
      const contract = await joinContract(client);
      deployed = contract;
      return contract;
    })();
  try {
    return await joining;
  } finally {
    joining = null;
  }
}

/**
 * Utility to run a function with the deployed contract, restarting the client once on failure for retry
 * @param fn The function to invoke with the deployed contract
 * @returns The result of the function invocation
 */
export async function runCircuit<T>(
  fn: (d: DeployedContract) => Promise<T>,
): Promise<T> {
  try {
    const contract = await getContract();
    return await fn(contract);
  } catch (e) {
    console.warn("Failed to run circuit. Closing client and retrying once:", e);
    await closeClient();
    const contract = await getContract();
    return await fn(contract);
  }
}

/**
 * Close the midnight client and wallet, saving state to disk
 */
export async function closeClient(): Promise<void> {
  try {
    if (client) {
      const { config, wallet } = client;
      await saveWallet(config.network, config.cacheDir, wallet);
      await wallet.close();
    }
  } catch (e) {
    console.warn("[midnight] close error:", e);
  } finally {
    client = null;
    deployed = null;
  }
}
