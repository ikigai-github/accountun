import {
  type BalancedTransaction,
  type MidnightProvider,
  type UnbalancedTransaction,
  type WalletProvider,
  createBalancedTx,
} from "@midnight-ntwrk/midnight-js-types";
import { indexerPublicDataProvider } from "@midnight-ntwrk/midnight-js-indexer-public-data-provider";
import { levelPrivateStateProvider } from "@midnight-ntwrk/midnight-js-level-private-state-provider";
import { httpClientProofProvider } from "@midnight-ntwrk/midnight-js-http-client-proof-provider";
import { NodeZkConfigProvider } from "@midnight-ntwrk/midnight-js-node-zk-config-provider";
import { Transaction as ZswapTransaction } from "@midnight-ntwrk/zswap";
import {
  getLedgerNetworkId,
  getZswapNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";
import type {
  CircuitKeys,
  MidnightConfig,
  PrivateState,
  PrivateStateId,
  Providers,
  Wallet,
} from "./types";
import {
  type CoinInfo,
  Transaction,
  type TransactionId,
} from "@midnight-ntwrk/ledger";
import { getWalletStateUnsynced } from "./wallet";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrivateStateKey } from "./constants";

/**
 * Utility wrapper to create a wallet provider that wraps a started wallet instance
 * @param wallet The started wallet instance to create the provider from
 * @returns a wallet provider that wraps the wallet and implements WalletProvider and MidnightProvider
 */
async function createWalletProvider(
  wallet: Wallet,
): Promise<WalletProvider & MidnightProvider> {
  // Don't wait for wallet to be fully synced because we just need the keys and ability to submit transactions
  const state = await getWalletStateUnsynced(wallet);
  return {
    coinPublicKey: state.coinPublicKey,
    encryptionPublicKey: state.encryptionPublicKey,
    balanceTx(
      tx: UnbalancedTransaction,
      newCoins: CoinInfo[],
    ): Promise<BalancedTransaction> {
      return wallet
        .balanceTransaction(
          ZswapTransaction.deserialize(
            tx.serialize(getLedgerNetworkId()),
            getZswapNetworkId(),
          ),
          newCoins,
        )
        .then((tx) => wallet.proveTransaction(tx))
        .then((zswapTx) =>
          Transaction.deserialize(
            zswapTx.serialize(getZswapNetworkId()),
            getLedgerNetworkId(),
          ),
        )
        .then(createBalancedTx);
    },
    submitTx(tx: BalancedTransaction): Promise<TransactionId> {
      return wallet.submitTransaction(tx);
    },
  };
}

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
  const privateStateProvider = levelPrivateStateProvider<
    PrivateStateId,
    PrivateState
  >({
    privateStateStoreName: PrivateStateKey,
  });

  const publicDataProvider = indexerPublicDataProvider(
    config.indexerHttpUri,
    config.indexerWsUri,
  );

  const moduleUrl = path.dirname(fileURLToPath(import.meta.url));
  const contractsDir = path.join(moduleUrl, "managed");
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
