import {
  createContract,
  buildWallet,
  createProviders,
  withWallet,
  type MidnightClient,
} from "@accountun/contract";

import { getConfig } from "../cli/config";

/**
 * Creates and initializes a Midnight client with configuration, providers, contract, wallet, and private state.
 * This will start the wallet which will need to be closed later with wallet.close().
 * @returns An initialized Midnight client with config, providers, contract, wallet, and private state
 */
export async function initializeClient(): Promise<MidnightClient> {
  const config = getConfig();
  const wallet = await buildWallet(config);

  wallet.start();

  const providers = await createProviders(config, wallet);

  const secretKey = config.authSecret;
  const replacementKey = config.authReplacementKey ?? config.authSecret;
  const contract = createContract();

  return {
    config,
    providers,
    contract,
    wallet,
    privateState: { secretKey, replacementKey },
  };
}

/**
 * Convenience wrapper that initializes a Midnight client, invokes a function, and then closes the wallet.
 * @param fn function to invoke using the initialized client
 * @returns the result of the function invocation
 */
export async function withClient<T>(
  fn: (client: MidnightClient) => Promise<T>,
): Promise<T> {
  const config = getConfig();
  return withWallet(config, async (wallet) => {
    const providers = await createProviders(config, wallet);

    // Ensure wallet state is saved on disk
    //await saveWallet(config.stateDir, wallet);

    const secretKey = config.authSecret;
    const replacementKey = config.authReplacementKey ?? config.authSecret;
    const contract = createContract();

    const client: MidnightClient = {
      config,
      providers,
      contract,
      wallet,
      privateState: { secretKey, replacementKey },
    };

    return fn(client);
  });
}
