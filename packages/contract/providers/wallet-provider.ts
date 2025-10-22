import {
  type BalancedTransaction,
  type MidnightProvider,
  type UnbalancedTransaction,
  type WalletProvider,
  createBalancedTx,
} from "@midnight-ntwrk/midnight-js-types";

import {
  NetworkId,
  Transaction as ZswapTransaction,
} from "@midnight-ntwrk/zswap";
import {
  getLedgerNetworkId,
  getZswapNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";
import type { Wallet } from "../types";
import {
  type CoinInfo,
  Transaction,
  type TransactionId,
} from "@midnight-ntwrk/ledger";
import { getWalletStateUnsynced } from "../wallet";

/**
 * Utility wrapper to create a wallet provider that wraps a started wallet instance
 * @param wallet The started wallet instance to create the provider from
 * @returns a wallet provider that wraps the wallet and implements WalletProvider and MidnightProvider
 */
export async function createWalletProvider(
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
        .then((tx: any) => wallet.proveTransaction(tx))
        .then(
          (zswapTx: {
            serialize: (arg0: NetworkId) => Uint8Array<ArrayBufferLike>;
          }) =>
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
