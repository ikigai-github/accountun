import { fileExists, isHex32, readFile, writeFile } from "@accountun/common";
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
import path from "node:path";
import { getWalletState, waitForWalletSyncAdvance } from "./wallet-sync";

export {
  getWalletState,
  getWalletStateUnsynced,
  waitForWalletSyncAdvance,
} from "./wallet-sync";
export { sendShieldedToken, sendUnshieldedToken } from "./wallet-transfers";

type UnshieldedCoinWithMeta = {
  utxo: ledger.Utxo;
  meta: { ctime: Date; registeredForDustGeneration?: boolean };
};

type ReconcilePlannerState = {
  lastWalletIndex: number;
};

export type DustReconcileRequest = {
  allocationId: string;
  dustAddress: string;
  targetSpecks: bigint;
  priority?: number;
};

export type DustReconcileAction = {
  allocationId: string;
  walletIndex: number;
  op: "assign" | "rebalance" | "register" | "sweep" | "noop";
  amountNight?: bigint;
  reason?: string;
};

export type DustReconcileSummary = {
  requestId: string;
  serviceDustAddress: string;
  reservePercent: bigint;
  totalNight: bigint;
  mainMinNight: bigint;
  mainActualNight: bigint;
  requestedSpecks: bigint;
  allocatedSpecks: bigint;
  shortfallSpecks: bigint;
  dryRun: boolean;
  actions: DustReconcileAction[];
  deallocated: Array<{
    walletIndex: number;
    sweptNight: bigint;
  }>;
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const DUST_RECONCILE_STATE_FILE = "dust/reconcile-state.json";

function getReconcileStatePath(config: MidnightConfig): string {
  return path.join(config.cacheDir, DUST_RECONCILE_STATE_FILE);
}

async function readLastWalletIndex(config: MidnightConfig): Promise<number> {
  const statePath = getReconcileStatePath(config);
  if (!(await fileExists(statePath))) {
    return 0;
  }

  try {
    const raw = await readFile(statePath);
    const parsed = JSON.parse(raw) as Partial<ReconcilePlannerState>;
    if (
      typeof parsed.lastWalletIndex === "number" &&
      Number.isInteger(parsed.lastWalletIndex) &&
      parsed.lastWalletIndex >= 0
    ) {
      return parsed.lastWalletIndex;
    }
  } catch {
    return 0;
  }

  return 0;
}

async function writeLastWalletIndex(
  config: MidnightConfig,
  value: number,
): Promise<void> {
  const safeValue = Number.isInteger(value) && value >= 0 ? value : 0;
  const payload: ReconcilePlannerState = { lastWalletIndex: safeValue };
  await writeFile(getReconcileStatePath(config), JSON.stringify(payload));
}

function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("Division by zero");
  return (a + b - 1n) / b;
}

function median(values: bigint[]): bigint {
  if (values.length === 0) {
    throw new Error("Cannot compute median of empty list");
  }
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor((sorted.length - 1) / 2)]!;
}

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

function normalizeReconcileRequests(
  requests: readonly DustReconcileRequest[],
): DustReconcileRequest[] {
  if (requests.length === 0) return [];

  const grouped = new Map<string, DustReconcileRequest>();

  for (const request of requests) {
    if (!request.allocationId || request.allocationId.trim() === "") {
      throw new Error("allocationId is required for each allocation");
    }

    MidnightBech32m.parse(request.dustAddress);
    if (request.targetSpecks < 0n) {
      throw new Error("targetSpecks must be >= 0");
    }

    const existing = grouped.get(request.allocationId);
    if (!existing) {
      grouped.set(request.allocationId, {
        allocationId: request.allocationId,
        dustAddress: request.dustAddress,
        targetSpecks: request.targetSpecks,
        priority: request.priority,
      });
      continue;
    }

    if (existing.dustAddress !== request.dustAddress) {
      throw new Error(
        `Duplicate allocationId '${request.allocationId}' has conflicting dustAddress values`,
      );
    }

    grouped.set(request.allocationId, {
      allocationId: request.allocationId,
      dustAddress: request.dustAddress,
      targetSpecks: existing.targetSpecks + request.targetSpecks,
      priority: existing.priority ?? request.priority,
    });
  }

  return [...grouped.values()].sort((a, b) =>
    a.allocationId.localeCompare(b.allocationId),
  );
}

function validateReservePercent(percent: bigint): void {
  if (percent < 0n || percent > 100n) {
    throw new Error("mainReservePercent must be between 0 and 100");
  }
}

/**
 * Plans deterministic dust allocations across derived sub-wallets.
 *
 * Planning scans wallet indices up to the greater of:
 * - requested allocation count
 * - previously persisted wallet usage (`lastWalletIndex`)
 *
 * Execution mode is not implemented yet; this currently returns a dry-run plan.
 */
export async function reconcileDustAllocations(
  config: MidnightConfig,
  requests: readonly DustReconcileRequest[],
  options?: {
    requestId?: string;
    timeoutMs?: number;
    mainReservePercent?: bigint;
    dryRun?: boolean;
  },
): Promise<DustReconcileSummary> {
  const normalized = normalizeReconcileRequests(requests);
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const reservePercent = options?.mainReservePercent ?? 50n;
  const dryRun = options?.dryRun ?? true;
  const requestId =
    options?.requestId ??
    `reconcile-${Date.now().toString(10)}-${Math.floor(Math.random() * 1_000_000).toString(10)}`;

  validateReservePercent(reservePercent);

  const persistedLastWalletIndex = await readLastWalletIndex(config);
  const requiredWalletCount = normalized.length;
  const scannedWalletCount = Math.max(
    requiredWalletCount,
    persistedLastWalletIndex,
  );

  const mainWallet = await buildWallet(config, { accountIndex: 0 });
  try {
    const mainState = await getWalletState(mainWallet, { timeoutMs });
    const serviceDustAddress = mainState.dust.dustAddress;
    const mainBalance = await getUnshieldedBalance(mainWallet, { timeoutMs });

    const snapshots: Array<{ walletIndex: number; balanceNight: bigint }> = [];
    for (let i = 0; i < scannedWalletCount; i += 1) {
      const walletIndex = i + 1;
      const wallet = await buildWallet(config, { accountIndex: walletIndex });
      try {
        const balanceNight = await getUnshieldedBalance(wallet, { timeoutMs });
        snapshots.push({ walletIndex, balanceNight });
      } finally {
        await wallet.wallet.stop();
      }
    }

    const balanceByWalletIndex = new Map<number, bigint>(
      snapshots.map((snapshot) => [
        snapshot.walletIndex,
        snapshot.balanceNight,
      ]),
    );

    const subTotal = snapshots.reduce((sum, s) => sum + s.balanceNight, 0n);
    const totalNight = mainBalance + subTotal;
    const mainMinNight = (totalNight * reservePercent) / 100n;
    const spendableFromMain =
      mainBalance > mainMinNight ? mainBalance - mainMinNight : 0n;

    const requestedSpecks = normalized.reduce(
      (sum, req) => sum + req.targetSpecks,
      0n,
    );

    let allocatedSpecks = 0n;
    const actions: DustReconcileAction[] = [];
    let availableBudget = spendableFromMain;

    const desiredWithEstimates = await Promise.all(
      normalized.map(async (req, i) => {
        let targetNight = 0n;
        if (req.targetSpecks > 0n) {
          targetNight = await estimateCoinAmountForDustTarget(
            mainWallet,
            req.targetSpecks,
            { timeoutMs },
          );
        }

        return {
          ...req,
          walletIndex: i + 1,
          targetNight,
          currentNight: balanceByWalletIndex.get(i + 1) ?? 0n,
        };
      }),
    );

    for (const entry of desiredWithEstimates) {
      if (entry.targetSpecks === 0n) {
        actions.push({
          allocationId: entry.allocationId,
          walletIndex: entry.walletIndex,
          op: "noop",
          reason: "targetSpecks is zero",
        });
        continue;
      }

      const deficit =
        entry.currentNight >= entry.targetNight
          ? 0n
          : entry.targetNight - entry.currentNight;

      if (deficit === 0n) {
        actions.push({
          allocationId: entry.allocationId,
          walletIndex: entry.walletIndex,
          op: "register",
          reason:
            "Wallet already funded; delegation/registration check required",
        });
        allocatedSpecks += entry.targetSpecks;
        continue;
      }

      if (availableBudget <= 0n) {
        actions.push({
          allocationId: entry.allocationId,
          walletIndex: entry.walletIndex,
          op: "rebalance",
          amountNight: 0n,
          reason: "Main wallet reserve floor reached",
        });
        continue;
      }

      const funding = deficit <= availableBudget ? deficit : availableBudget;
      availableBudget -= funding;

      actions.push({
        allocationId: entry.allocationId,
        walletIndex: entry.walletIndex,
        op: entry.currentNight === 0n ? "assign" : "rebalance",
        amountNight: funding,
        reason:
          funding < deficit ? "Partially funded due to reserve cap" : undefined,
      });

      if (funding === deficit) {
        allocatedSpecks += entry.targetSpecks;
      }
    }

    const deallocated: Array<{ walletIndex: number; sweptNight: bigint }> = [];
    for (const snapshot of snapshots) {
      if (
        snapshot.walletIndex <= requiredWalletCount ||
        snapshot.balanceNight <= 0n
      ) {
        continue;
      }

      actions.push({
        allocationId: `sweep-${snapshot.walletIndex}`,
        walletIndex: snapshot.walletIndex,
        op: "sweep",
        amountNight: snapshot.balanceNight,
        reason: "Wallet index no longer requested; candidate sweep to main",
      });

      deallocated.push({
        walletIndex: snapshot.walletIndex,
        sweptNight: snapshot.balanceNight,
      });
    }

    const shortfallSpecks = requestedSpecks - allocatedSpecks;

    await writeLastWalletIndex(config, scannedWalletCount);

    if (!dryRun) {
      throw new Error(
        "Execution mode is not enabled yet for reconcileDustAllocations; run with dryRun=true",
      );
    }

    return {
      requestId,
      serviceDustAddress,
      reservePercent,
      totalNight,
      mainMinNight,
      mainActualNight: mainBalance,
      requestedSpecks,
      allocatedSpecks,
      shortfallSpecks,
      dryRun,
      actions,
      deallocated,
    };
  } finally {
    await mainWallet.wallet.stop();
  }
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
 * Estimates NIGHT amount required to reach a dust target in Specks based on
 * current generation estimates for available NIGHT coins.
 */
export async function estimateCoinAmountForDustTarget(
  wallet: WalletContext,
  targetSpecks: bigint,
  options?: { timeoutMs?: number },
): Promise<bigint> {
  if (targetSpecks <= 0n) {
    throw new Error("Target Specks must be positive");
  }

  const timeoutMs = options?.timeoutMs ?? 180_000;
  const state = await getWalletState(wallet, { timeoutMs });
  const unshieldedCoins = state.unshielded.availableCoins.filter((coin) =>
    isNightCoin(coin),
  ) as UnshieldedCoinWithMeta[];

  if (unshieldedCoins.length === 0) {
    throw new Error("No NIGHT coins available");
  }

  const now = new Date();
  const dustUtxos = unshieldedCoins.map((coin) => ({
    ...coin.utxo,
    ctime:
      coin.meta.ctime instanceof Date
        ? coin.meta.ctime
        : new Date(coin.meta.ctime),
  }));

  const estimates = state.dust.estimateDustGeneration(dustUtxos, now);
  if (estimates.length === 0) {
    throw new Error("No dust generation estimates available");
  }

  const requireds = estimates
    .filter((estimate) => estimate.utxo.value > 0n && estimate.dust.maxCap > 0n)
    .map((estimate) =>
      ceilDiv(targetSpecks * estimate.utxo.value, estimate.dust.maxCap),
    );

  if (requireds.length === 0) {
    throw new Error("Dust estimates returned zero values");
  }

  return median(requireds);
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
