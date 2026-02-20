import { isHex32 } from "@accountun/common";
import type { MidnightConfig, WalletContext } from "./types";
import { WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import { ShieldedWallet } from "@midnight-ntwrk/wallet-sdk-shielded";
import { DustWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import { MidnightBech32m } from "@midnight-ntwrk/wallet-sdk-address-format";
import * as ledger from "@midnight-ntwrk/ledger-v7";
import { shieldedToken, unshieldedToken } from "@midnight-ntwrk/ledger-v7";
import {
  getNetworkId,
  setNetworkId as setMidnightJsNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";
import { Buffer } from "buffer";
import {
  isDustEligibleUnshieldedNightCoin,
  isDustRegistered,
} from "./utilities/dust";
import { getWalletState, waitForWalletSyncAdvance } from "./wallet-sync";

export {
  getWalletState,
  getWalletStateUnsynced,
  waitForWalletSyncAdvance,
} from "./wallet-sync";
export { sendShieldedToken, sendUnshieldedToken } from "./wallet-transfers";
export * from "./wallet-dust";

type UnshieldedCoinWithMeta = {
  utxo: ledger.Utxo;
  meta: { ctime: Date; registeredForDustGeneration?: boolean };
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function isNightCoin(
  coin: { utxo: { type: string } },
  tokenRaw: string = unshieldedToken().raw,
): boolean {
  return coin.utxo.type === tokenRaw;
}

function buildShieldedConfig(config: MidnightConfig) {
  return {
    networkId: getNetworkId(),
    indexerClientConnection: {
      indexerHttpUrl: config.indexerHttpUri,
      indexerWsUrl: config.indexerWsUri,
    },
    provingServerUrl: new URL(config.proofServerUri),
    relayURL: new URL(config.substrateNodeUri.replace(/^http/, "ws")),
  };
}

function buildUnshieldedConfig(config: MidnightConfig) {
  return {
    networkId: getNetworkId(),
    indexerClientConnection: {
      indexerHttpUrl: config.indexerHttpUri,
      indexerWsUrl: config.indexerWsUri,
    },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  };
}

function buildDustConfig(config: MidnightConfig) {
  return {
    networkId: getNetworkId(),
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
    indexerClientConnection: {
      indexerHttpUrl: config.indexerHttpUri,
      indexerWsUrl: config.indexerWsUri,
    },
    provingServerUrl: new URL(config.proofServerUri),
    relayURL: new URL(config.substrateNodeUri.replace(/^http/, "ws")),
  };
}

async function submitFinalizedTransactionAndSync(
  wallet: WalletContext,
  finalizedTx: ledger.FinalizedTransaction,
  options?: { timeoutMs?: number; awaitConfirmation?: boolean },
): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const baselineState = options?.awaitConfirmation
    ? await getWalletState(wallet, { timeoutMs })
    : undefined;

  const txId = await wallet.wallet.submitTransaction(finalizedTx);

  if (options?.awaitConfirmation) {
    await waitForWalletSyncAdvance(wallet, {
      baselineState,
      timeoutMs,
      txId,
    });
  }

  return txId;
}

function deriveKeysFromSeed(seedHex: string, accountIndex: number = 0) {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seedHex, "hex"));
  if (hdWallet.type !== "seedOk") {
    throw new Error("Failed to initialize HDWallet from seed");
  }

  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error("accountIndex must be a non-negative integer");
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(accountIndex)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== "keysDerived") {
    throw new Error("Failed to derive wallet keys");
  }

  hdWallet.hdWallet.clear();
  return derivationResult.keys;
}

/**
 * Builds a wallet from the configured seed using the wallet SDK facade.
 * @param config Config for connecting to midnight while building the wallet
 * @returns a started wallet context
 */
export async function buildWallet(
  config: MidnightConfig,
  options?: { accountIndex?: number },
): Promise<WalletContext> {
  const { serviceWalletSeedHex, network } = config;

  if (!isHex32(serviceWalletSeedHex)) {
    throw new Error(
      "SERVICE_WALLET_SEED_HEX must be 32-byte hex (64 hex chars, no 0x).",
    );
  }

  // Whenever we build a wallet, we need to set the configured matching network ID
  setMidnightJsNetworkId(network);

  const keys = deriveKeysFromSeed(
    serviceWalletSeedHex,
    options?.accountIndex ?? 0,
  );
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(
    keys[Roles.NightExternal],
    getNetworkId(),
  );

  const shieldedWallet = ShieldedWallet(
    buildShieldedConfig(config),
  ).startWithSecretKeys(shieldedSecretKeys);
  const unshieldedWallet = UnshieldedWallet(
    buildUnshieldedConfig(config),
  ).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));
  const dustWallet = DustWallet(buildDustConfig(config)).startWithSecretKey(
    dustSecretKey,
    ledger.LedgerParameters.initialParameters().dust,
  );

  const wallet = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return {
    wallet,
    shieldedSecretKeys,
    dustSecretKey,
    unshieldedKeystore,
  };
}

export async function getAssetBalance(
  wallet: WalletContext,
  options: {
    kind: "shielded" | "unshielded";
    assetId?: string;
    timeoutMs?: number; // default 120s
    onProgress?: (info: { synced: boolean }) => void;
  },
): Promise<bigint> {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const assetId =
    options.assetId ??
    (options.kind === "shielded" ? shieldedToken().raw : unshieldedToken().raw);

  const state = await getWalletState(wallet, {
    timeoutMs,
  });

  return options.kind === "shielded"
    ? (state.shielded.balances?.[assetId] ?? 0n)
    : (state.unshielded.balances?.[assetId] ?? 0n);
}

export async function getUnshieldedBalance(
  wallet: WalletContext,
  options?: {
    assetId?: string;
    timeoutMs?: number; // default 120s
    onProgress?: (info: { synced: boolean }) => void;
  },
): Promise<bigint> {
  return getAssetBalance(wallet, {
    kind: "unshielded",
    assetId: options?.assetId,
    timeoutMs: options?.timeoutMs,
    onProgress: options?.onProgress,
  });
}

export async function getShieldedBalance(
  wallet: WalletContext,
  options?: {
    assetId?: string;
    timeoutMs?: number; // default 120s
    onProgress?: (info: { synced: boolean }) => void;
  },
): Promise<bigint> {
  return getAssetBalance(wallet, {
    kind: "shielded",
    assetId: options?.assetId,
    timeoutMs: options?.timeoutMs,
    onProgress: options?.onProgress,
  });
}

/**
 * Register NIGHT/tNIGHT coins for dust generation and optionally set a dust receiver address.
 * @param wallet The wallet context to use
 * @param options Optional configuration for dust registration
 * @returns The submitted transaction id and number of coins registered
 */
export async function registerAvailableDustCoins(
  wallet: WalletContext,
  options?: {
    dustReceiverAddress?: string; // bech32m dust address
    timeoutMs?: number; // default 3 min
    awaitConfirmation?: boolean;
  },
): Promise<{ txId: string; registeredCoins: number } | null> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const state = await getWalletState(wallet, { timeoutMs });

  const unshieldedCoins = state.unshielded.availableCoins;
  const nightCoins = unshieldedCoins.filter((coin) =>
    isDustEligibleUnshieldedNightCoin(coin),
  );

  if (nightCoins.length === 0) return null;

  const dustAddress = options?.dustReceiverAddress;
  if (dustAddress) {
    MidnightBech32m.parse(dustAddress);
  }

  const recipe = await wallet.wallet.registerNightUtxosForDustGeneration(
    nightCoins,
    wallet.unshieldedKeystore.getPublicKey(),
    (payload) => wallet.unshieldedKeystore.signData(payload),
    dustAddress,
  );

  const finalized = await wallet.wallet.finalizeRecipe(recipe);
  const txId = await submitFinalizedTransactionAndSync(wallet, finalized, {
    timeoutMs,
    awaitConfirmation: options?.awaitConfirmation,
  });

  return { txId, registeredCoins: nightCoins.length };
}

/**
 * Select unregistered unshielded coins closest to a target amount, optionally
 * rebalancing to create a matching coin.
 */
export async function selectDustCoinsForAmount(
  wallet: WalletContext,
  targetAmount: bigint,
  options?: {
    tolerance?: bigint; // default 5%
    timeoutMs?: number; // default 3 min
    allowRebalance?: boolean;
  },
): Promise<UnshieldedCoinWithMeta[]> {
  if (targetAmount <= 0n) {
    throw new Error("Target amount must be positive");
  }

  const timeoutMs = options?.timeoutMs ?? 180_000;
  const computedTolerance = (targetAmount * 5n) / 100n;
  const tolerance =
    options?.tolerance ?? (computedTolerance > 0n ? computedTolerance : 1n); // 5%, min 1

  const state = await getWalletState(wallet, { timeoutMs });
  const unshieldedCoins = state.unshielded.availableCoins.filter((coin) =>
    isDustEligibleUnshieldedNightCoin(coin),
  ) as UnshieldedCoinWithMeta[];

  const withinRange = unshieldedCoins.filter((coin) => {
    const value = coin.utxo.value;
    return (
      value >= targetAmount - tolerance && value <= targetAmount + tolerance
    );
  });

  if (withinRange.length > 0) {
    return withinRange
      .sort((a, b) => {
        const da =
          a.utxo.value > targetAmount
            ? a.utxo.value - targetAmount
            : targetAmount - a.utxo.value;
        const db =
          b.utxo.value > targetAmount
            ? b.utxo.value - targetAmount
            : targetAmount - b.utxo.value;
        return da < db ? -1 : da > db ? 1 : 0;
      })
      .slice(0, 1);
  }

  if (!options?.allowRebalance) {
    return [];
  }

  await rebalanceUnshieldedNightCoins(wallet, [targetAmount], { timeoutMs });
  const updated = await getWalletState(wallet, { timeoutMs });
  const updatedCoins = updated.unshielded.availableCoins.filter((coin) =>
    isDustEligibleUnshieldedNightCoin(coin),
  ) as UnshieldedCoinWithMeta[];

  return updatedCoins.filter((coin) => {
    const value = coin.utxo.value;
    return (
      value >= targetAmount - tolerance && value <= targetAmount + tolerance
    );
  });
}

/**
 * Register a specific set of unshielded coins for dust generation.
 */
export async function registerDustCoins(
  wallet: WalletContext,
  coins: readonly UnshieldedCoinWithMeta[],
  options?: {
    dustReceiverAddress?: string;
    timeoutMs?: number;
    awaitConfirmation?: boolean;
  },
): Promise<string> {
  if (coins.length === 0) {
    throw new Error("At least one coin is required for dust registration");
  }

  const timeoutMs = options?.timeoutMs ?? 180_000;
  const dustAddress = options?.dustReceiverAddress;
  if (dustAddress) {
    MidnightBech32m.parse(dustAddress);
  }

  await getWalletState(wallet, { timeoutMs });

  const recipe = await wallet.wallet.registerNightUtxosForDustGeneration(
    coins,
    wallet.unshieldedKeystore.getPublicKey(),
    (payload) => wallet.unshieldedKeystore.signData(payload),
    dustAddress,
  );

  const finalized = await wallet.wallet.finalizeRecipe(recipe);
  return await submitFinalizedTransactionAndSync(wallet, finalized, {
    timeoutMs,
    awaitConfirmation: options?.awaitConfirmation,
  });
}

async function deregisterDustCoins(
  wallet: WalletContext,
  coins: readonly UnshieldedCoinWithMeta[],
  options?: {
    timeoutMs?: number;
    awaitConfirmation?: boolean;
  },
): Promise<string> {
  if (coins.length === 0) {
    throw new Error("At least one coin is required for dust deregistration");
  }

  const timeoutMs = options?.timeoutMs ?? 180_000;

  await getWalletState(wallet, { timeoutMs });

  const recipe = await wallet.wallet.deregisterFromDustGeneration(
    [...coins],
    wallet.unshieldedKeystore.getPublicKey(),
    (payload) => wallet.unshieldedKeystore.signData(payload),
  );

  const finalized = await wallet.wallet.finalizeRecipe(recipe);
  return await submitFinalizedTransactionAndSync(wallet, finalized, {
    timeoutMs,
    awaitConfirmation: options?.awaitConfirmation,
  });
}

/**
 * Split/merge unshielded NIGHT coins by sending multiple outputs to a target address.
 * @param wallet The wallet context to use
 * @param amounts Output amounts to create (must be > 0)
 * @param options Optional configuration for the split/merge
 * @returns The submitted transaction id
 */
export async function rebalanceUnshieldedNightCoins(
  wallet: WalletContext,
  amounts: readonly bigint[],
  options?: {
    receiverAddress?: string; // bech32m unshielded address (defaults to wallet)
    timeoutMs?: number; // default 3 min
    payFees?: boolean; // default true
    awaitConfirmation?: boolean;
  },
): Promise<string> {
  if (amounts.length === 0) {
    throw new Error("At least one output amount is required");
  }

  const invalid = amounts.find((v) => v <= 0n);
  if (invalid !== undefined) {
    throw new Error("All output amounts must be positive");
  }

  const timeoutMs = options?.timeoutMs ?? 180_000;
  await getWalletState(wallet, { timeoutMs });

  const receiverInput =
    options?.receiverAddress ?? wallet.unshieldedKeystore.getBech32Address();
  const receiverBech32 =
    typeof receiverInput === "string"
      ? receiverInput
      : receiverInput.toString();
  MidnightBech32m.parse(receiverBech32);

  const recipe = await wallet.wallet.transferTransaction(
    [
      {
        type: "unshielded",
        outputs: amounts.map((amount) => ({
          amount,
          type: unshieldedToken().raw,
          receiverAddress: receiverBech32,
        })),
      },
    ],
    {
      shieldedSecretKeys: wallet.shieldedSecretKeys,
      dustSecretKey: wallet.dustSecretKey,
    },
    {
      ttl: new Date(Date.now() + DEFAULT_TTL_MS),
      payFees: options?.payFees,
    },
  );

  const signedTx = await wallet.wallet.signUnprovenTransaction(
    recipe.transaction,
    (payload) => wallet.unshieldedKeystore.signData(payload),
  );
  const finalized = await wallet.wallet.finalizeTransaction(signedTx);
  return await submitFinalizedTransactionAndSync(wallet, finalized, {
    timeoutMs,
    awaitConfirmation: options?.awaitConfirmation,
  });
}

type CoinRef = { txId: string; index: number };

/**
 * Deregister dust generation for specific NIGHT/tNIGHT coins.
 * @param wallet The wallet context to use
 * @param coins Transaction id + index references of the coins to deregister
 * @param options Optional configuration
 * @returns The submitted transaction id
 */
export async function deregisterDustForCoins(
  wallet: WalletContext,
  coins: readonly CoinRef[],
  options?: { timeoutMs?: number; awaitConfirmation?: boolean },
): Promise<string> {
  if (coins.length === 0) {
    throw new Error("At least one coin reference is required");
  }

  const timeoutMs = options?.timeoutMs ?? 180_000;
  const state = await getWalletState(wallet, { timeoutMs });

  const availableCoins = state.unshielded.availableCoins;
  const refs = new Set(coins.map((u) => `${u.txId}:${u.index}`));
  const selectedCoins = availableCoins.filter((coin) => {
    const txId = (coin.utxo as { txId?: string }).txId;
    const index = (coin.utxo as { index?: number }).index;
    if (typeof txId !== "string" || typeof index !== "number") return false;
    return refs.has(`${txId}:${index}`);
  });

  if (selectedCoins.length === 0) {
    throw new Error("No matching coins found to deregister");
  }

  return await deregisterDustCoins(wallet, selectedCoins, {
    timeoutMs,
    awaitConfirmation: options?.awaitConfirmation,
  });
}

/**
 * Deregister dust generation for all currently registered NIGHT/tNIGHT coins.
 * @param wallet The wallet context to use
 * @param options Optional configuration
 * @returns The submitted transaction id, or null if nothing to deregister
 */
export async function deregisterAllDust(
  wallet: WalletContext,
  options?: { timeoutMs?: number; awaitConfirmation?: boolean },
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const state = await getWalletState(wallet, { timeoutMs });

  const coins = state.unshielded.availableCoins.filter(
    (coin) => isNightCoin(coin) && isDustRegistered(coin),
  );

  if (coins.length === 0) return null;

  const recipe = await wallet.wallet.deregisterFromDustGeneration(
    coins,
    wallet.unshieldedKeystore.getPublicKey(),
    (payload) => wallet.unshieldedKeystore.signData(payload),
  );

  const finalized = await wallet.wallet.finalizeRecipe(recipe);
  return await submitFinalizedTransactionAndSync(wallet, finalized, {
    timeoutMs,
    awaitConfirmation: options?.awaitConfirmation,
  });
}

/**
 * Utility wrapper that starts a wallet, invokes a function, and then closes the wallet.
 * @param config Config for building the wallet
 * @param fn function to invoke using the started wallet
 * @returns the result of the function invocation
 */
export async function withWallet<T>(
  config: MidnightConfig,
  fn: (wallet: WalletContext) => Promise<T>,
): Promise<T> {
  const wallet = await buildWallet(config);
  try {
    return await fn(wallet);
  } finally {
    await wallet.wallet.stop();
  }
}
