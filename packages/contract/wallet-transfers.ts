import type { WalletContext } from "./types";
import { MidnightBech32m } from "@midnight-ntwrk/wallet-sdk-address-format";
import { shieldedToken, unshieldedToken } from "@midnight-ntwrk/ledger-v7";

const DEFAULT_TTL_MS = 30 * 60 * 1000;

/**
 * Sends unshielded NIGHT from the wallet to a receiver address.
 */
export async function sendUnshieldedToken(
  wallet: WalletContext,
  receiverAddress: string,
  amount: bigint,
): Promise<string> {
  if (amount <= 0n) {
    throw new Error("Amount must be positive");
  }

  MidnightBech32m.parse(receiverAddress);

  const recipe = await wallet.wallet.transferTransaction(
    [
      {
        type: "unshielded",
        outputs: [
          {
            amount,
            type: unshieldedToken().raw,
            receiverAddress,
          },
        ],
      },
    ],
    {
      shieldedSecretKeys: wallet.shieldedSecretKeys,
      dustSecretKey: wallet.dustSecretKey,
    },
    { ttl: new Date(Date.now() + DEFAULT_TTL_MS) },
  );

  const signedTx = await wallet.wallet.signUnprovenTransaction(
    recipe.transaction,
    (payload) => wallet.unshieldedKeystore.signData(payload),
  );
  const finalized = await wallet.wallet.finalizeTransaction(signedTx);
  return await wallet.wallet.submitTransaction(finalized);
}

/**
 * Sends shielded NIGHT from the wallet to a receiver address.
 */
export async function sendShieldedToken(
  wallet: WalletContext,
  receiverAddress: string,
  amount: bigint,
): Promise<string> {
  if (amount <= 0n) {
    throw new Error("Amount must be positive");
  }

  MidnightBech32m.parse(receiverAddress);

  const recipe = await wallet.wallet.transferTransaction(
    [
      {
        type: "shielded",
        outputs: [
          {
            amount,
            type: shieldedToken().raw,
            receiverAddress,
          },
        ],
      },
    ],
    {
      shieldedSecretKeys: wallet.shieldedSecretKeys,
      dustSecretKey: wallet.dustSecretKey,
    },
    { ttl: new Date(Date.now() + DEFAULT_TTL_MS) },
  );

  const finalized = await wallet.wallet.finalizeRecipe(recipe);
  return await wallet.wallet.submitTransaction(finalized);
}
