import { isHex32 } from "@accountun/common";
import type { MidnightConfig, NetworkName, WalletContext } from "./types";
import type { FacadeState } from "@midnight-ntwrk/wallet-sdk-facade";
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
import {
  MidnightBech32m,
  UnshieldedAddress,
} from "@midnight-ntwrk/wallet-sdk-address-format";
import * as ledger from "@midnight-ntwrk/ledger-v7";
import { shieldedToken, unshieldedToken } from "@midnight-ntwrk/ledger-v7";
import {
  getNetworkId,
  setNetworkId as setMidnightJsNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";
import {
  bufferCount,
  filter,
  firstValueFrom,
  map,
  shareReplay,
  take,
  tap,
  throttleTime,
  timeout,
} from "rxjs";
import { Buffer } from "buffer";
import {
  isDustEligibleUnshieldedNightCoin,
  isDustRegistered,
} from "./utilities/dust";

type WalletState = FacadeState;
type UnshieldedCoinWithMeta = {
  utxo: ledger.Utxo;
  meta: { ctime: Date; registeredForDustGeneration?: boolean };
};

export type DustAllocationRequest = {
  dustAddress: string;
  targetDust: bigint;
  allocationId?: string;
};

export type DustAllocationApplied = {
  dustAddress: string;
  targetDust: bigint;
  targetAmount: bigint;
  allocationId?: string;
  selectedCoin: {
    txId?: string;
    index?: number;
    value: bigint;
  };
  registrationTxId: string;
};

export type DustAllocationSummary = {
  serviceDustAddress: string;
  requestedCount: number;
  estimatedTotalAmount: bigint;
  rebalanceTxId: string | null;
  allocations: DustAllocationApplied[];
  remainderRegistrationTxId: string | null;
  remainderRegisteredCoins: number;
};

const DEFAULT_TTL_MS = 30 * 60 * 1000;

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

function absoluteDiff(a: bigint, b: bigint): bigint {
  return a >= b ? a - b : b - a;
}

function isNightCoin(
  coin: { utxo: { type: string } },
  tokenRaw: string = unshieldedToken().raw,
): boolean {
  return coin.utxo.type === tokenRaw;
}

function normalizeRequests(
  requests: readonly DustAllocationRequest[],
): DustAllocationRequest[] {
  const grouped = new Map<string, DustAllocationRequest>();

  for (const request of requests) {
    MidnightBech32m.parse(request.dustAddress);
    if (request.targetDust <= 0n) {
      throw new Error("Each target dust amount must be positive");
    }

    const existing = grouped.get(request.dustAddress);
    if (!existing) {
      grouped.set(request.dustAddress, { ...request });
      continue;
    }

    grouped.set(request.dustAddress, {
      dustAddress: request.dustAddress,
      targetDust: existing.targetDust + request.targetDust,
      allocationId: existing.allocationId ?? request.allocationId,
    });
  }

  return [...grouped.values()];
}

function pickCoinsForTargets(
  coins: readonly UnshieldedCoinWithMeta[],
  targets: readonly bigint[],
  tolerancePercent: bigint,
): Array<UnshieldedCoinWithMeta | null> {
  const used = new Set<number>();

  return targets.map((target) => {
    const tolerance = (target * tolerancePercent) / 100n;
    let best: {
      coin: UnshieldedCoinWithMeta;
      idx: number;
      diff: bigint;
    } | null = null;

    for (let idx = 0; idx < coins.length; idx += 1) {
      if (used.has(idx)) continue;
      const coin = coins[idx]!;
      const diff = absoluteDiff(coin.utxo.value, target);
      if (diff > tolerance) continue;
      if (!best || diff < best.diff) {
        best = { coin, idx, diff };
      }
    }

    if (!best) {
      return null;
    }

    used.add(best.idx);
    return best.coin;
  });
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

function deriveKeysFromSeed(seedHex: string) {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seedHex, "hex"));
  if (hdWallet.type !== "seedOk") {
    throw new Error("Failed to initialize HDWallet from seed");
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
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
): Promise<WalletContext> {
  const { serviceWalletSeedHex, network } = config;

  if (!isHex32(serviceWalletSeedHex)) {
    throw new Error(
      "SERVICE_WALLET_SEED_HEX must be 32-byte hex (64 hex chars, no 0x).",
    );
  }

  // Whenever we build a wallet, we need to set the configured matching network ID
  setMidnightJsNetworkId(network);

  const keys = deriveKeysFromSeed(serviceWalletSeedHex);
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

/**
 * Then gets the current wallet state without waiting for sync
 * @param wallet the started wallet to get the state from
 * @returns The unsynced wallet state
 */
export async function getWalletStateUnsynced(
  wallet: WalletContext,
): Promise<WalletState> {
  return firstValueFrom(wallet.wallet.state());
}

/**
 * Waits for the wallet to sync to within a certain number of blocks of the latest known block.
 * @param wallet the started wallet instance to wait for sync
 * @param options options for controlling sync behavior
 * @returns The wallet state once synced
 */
export async function getWalletState(
  wallet: WalletContext,
  options?: {
    timeoutMs?: number; // default 3 min
    throttleMs?: number; // progress throttle (default 2s)
    minConsecutive?: number; // require N consecutive ok samples (default 2)
    onProgress?: (p: { synced: boolean }) => void;
  },
): Promise<WalletState> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const throttleMs = options?.throttleMs ?? 2_000;
  const minConsecutive = Math.max(1, options?.minConsecutive ?? 2);

  // One shared, replayed source for both waiting & reading
  const src$ = wallet.wallet
    .state()
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  // Optional progress logging (throttled), does not affect gating
  const progressSub = src$
    .pipe(
      throttleTime(throttleMs, undefined, { leading: true, trailing: true }),
      tap((s: WalletState) => {
        if (!options?.onProgress) return;
        options.onProgress({ synced: s.isSynced });
      }),
    )
    .subscribe();

  try {
    type Gate = { state: WalletState; ok: boolean };
    // Gate: wait until within threshold (unthrottled)
    const gate$ = src$.pipe(
      map<WalletState, Gate>((state) => ({
        state,
        ok: state.isSynced,
      })),
      bufferCount(minConsecutive, 1),
      filter(
        (buffer: Gate[]) =>
          buffer.length === minConsecutive && buffer.every((g) => g.ok),
      ),
      map((buffer: Gate[]) => buffer[buffer.length - 1]!.state),
      take(1),
    );

    const withTimeout =
      timeoutMs > 0 ? gate$.pipe(timeout({ each: timeoutMs })) : gate$;

    return await firstValueFrom(withTimeout);
  } finally {
    progressSub.unsubscribe();
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
 * Utility to send unshielded tNight from the wallet to a receiver address
 * @param wallet The wallet to send tNight from
 * @param receiverAddress The receiver of the tNight
 * @param amount The amount of tNight to send
 * @returns
 */
export async function sendUnshieldedToken(
  wallet: WalletContext,
  receiverAddress: string,
  amount: bigint,
) {
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
 * Utility to send shielded NIGHT from the wallet to a receiver address
 * @param wallet The wallet to send NIGHT from
 * @param receiverAddress The receiver of the NIGHT
 * @param amount The amount of NIGHT to send
 * @returns
 */
export async function sendShieldedToken(
  wallet: WalletContext,
  receiverAddress: string,
  amount: bigint,
) {
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
  const txId = await wallet.wallet.submitTransaction(finalized);

  return { txId, registeredCoins: nightCoins.length };
}

/**
 * Estimate the NIGHT coin amount needed to reach a target dust cap, based on
 * current dust generation estimates for available NIGHT coins.
 */
export async function estimateCoinAmountForDustTarget(
  wallet: WalletContext,
  targetDust: bigint,
  options?: { timeoutMs?: number },
): Promise<bigint> {
  if (targetDust <= 0n) {
    throw new Error("Target dust must be positive");
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
      ceilDiv(targetDust * estimate.utxo.value, estimate.dust.maxCap),
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
  const tolerance = options?.tolerance ?? (targetAmount * 5n) / 100n; // 5%

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
  return await wallet.wallet.submitTransaction(finalized);
}

/**
 * Reconcile all dust allocations in one snapshot-style operation.
 * Request allocations are applied,
 * and remaining eligible coins are assigned back to the service dust address.
 */
export async function allocateDust(
  wallet: WalletContext,
  requests: readonly DustAllocationRequest[],
  options?: {
    timeoutMs?: number;
    tolerancePercent?: bigint; // default 5
    allowRebalance?: boolean; // default true
  },
): Promise<DustAllocationSummary> {
  const normalized = normalizeRequests(requests);
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const tolerancePercent = options?.tolerancePercent ?? 5n;
  const allowRebalance = options?.allowRebalance ?? true;

  if (tolerancePercent < 0n) {
    throw new Error("Tolerance percent cannot be negative");
  }

  const initial = await getWalletState(wallet, { timeoutMs });
  const serviceDustAddress = initial.dust.dustAddress;

  const targetAmounts: bigint[] = [];
  for (const req of normalized) {
    const estimated = await estimateCoinAmountForDustTarget(
      wallet,
      req.targetDust,
      { timeoutMs },
    );
    targetAmounts.push(estimated);
  }

  const estimatedTotalAmount = targetAmounts.reduce((a, b) => a + b, 0n);

  let state = await getWalletState(wallet, { timeoutMs });
  let eligibleCoins = state.unshielded.availableCoins.filter((coin) =>
    isNightCoin(coin),
  ) as UnshieldedCoinWithMeta[];

  let selected = pickCoinsForTargets(
    eligibleCoins,
    targetAmounts,
    tolerancePercent,
  );

  let rebalanceTxId: string | null = null;
  if (selected.some((coin) => coin === null)) {
    if (!allowRebalance) {
      throw new Error(
        "Unable to satisfy dust allocations from current coin set without rebalancing",
      );
    }

    rebalanceTxId = await rebalanceUnshieldedNightCoins(wallet, targetAmounts, {
      timeoutMs,
    });
    state = await getWalletState(wallet, { timeoutMs });
    eligibleCoins = state.unshielded.availableCoins.filter((coin) =>
      isNightCoin(coin),
    ) as UnshieldedCoinWithMeta[];

    selected = pickCoinsForTargets(
      eligibleCoins,
      targetAmounts,
      tolerancePercent,
    );
    if (selected.some((coin) => coin === null)) {
      throw new Error(
        "Unable to satisfy dust allocations after rebalancing; consider increasing tolerance",
      );
    }
  }

  const allocations: DustAllocationApplied[] = [];
  const selectedRefs = new Set<string>();

  for (let i = 0; i < normalized.length; i += 1) {
    const req = normalized[i]!;
    const coin = selected[i]!;
    if (!coin) {
      throw new Error("Internal selection error while registering dust coins");
    }

    const txId = await registerDustCoins(wallet, [coin], {
      timeoutMs,
      dustReceiverAddress: req.dustAddress,
    });

    const coinTxId = (coin.utxo as { txId?: string }).txId;
    const coinIndex = (coin.utxo as { index?: number }).index;
    selectedRefs.add(`${coinTxId ?? ""}:${coinIndex ?? -1}`);

    allocations.push({
      dustAddress: req.dustAddress,
      targetDust: req.targetDust,
      targetAmount: targetAmounts[i]!,
      allocationId: req.allocationId,
      selectedCoin: {
        txId: coinTxId,
        index: coinIndex,
        value: coin.utxo.value,
      },
      registrationTxId: txId,
    });
  }

  const postAllocState = await getWalletState(wallet, { timeoutMs });
  const remainderCoins = postAllocState.unshielded.availableCoins.filter(
    (coin) => {
      if (!isNightCoin(coin)) return false;
      const txId = (coin.utxo as { txId?: string }).txId;
      const index = (coin.utxo as { index?: number }).index;
      return !selectedRefs.has(`${txId ?? ""}:${index ?? -1}`);
    },
  ) as UnshieldedCoinWithMeta[];

  let remainderRegistrationTxId: string | null = null;
  if (remainderCoins.length > 0) {
    remainderRegistrationTxId = await registerDustCoins(
      wallet,
      remainderCoins,
      {
        timeoutMs,
        dustReceiverAddress: serviceDustAddress,
      },
    );
  }

  return {
    serviceDustAddress,
    requestedCount: normalized.length,
    estimatedTotalAmount,
    rebalanceTxId,
    allocations,
    remainderRegistrationTxId,
    remainderRegisteredCoins: remainderCoins.length,
  };
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
  return await wallet.wallet.submitTransaction(finalized);
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
  options?: { timeoutMs?: number },
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

  const recipe = await wallet.wallet.deregisterFromDustGeneration(
    selectedCoins,
    wallet.unshieldedKeystore.getPublicKey(),
    (payload) => wallet.unshieldedKeystore.signData(payload),
  );

  const finalized = await wallet.wallet.finalizeRecipe(recipe);
  return await wallet.wallet.submitTransaction(finalized);
}

/**
 * Deregister dust generation for all currently registered NIGHT/tNIGHT coins.
 * @param wallet The wallet context to use
 * @param options Optional configuration
 * @returns The submitted transaction id, or null if nothing to deregister
 */
export async function deregisterAllDust(
  wallet: WalletContext,
  options?: { timeoutMs?: number },
): Promise<string | null> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const state = await getWalletState(wallet, { timeoutMs });

  const coins = state.unshielded.availableCoins.filter((coin) =>
    isDustRegistered(coin),
  );

  if (coins.length === 0) return null;

  const recipe = await wallet.wallet.deregisterFromDustGeneration(
    coins,
    wallet.unshieldedKeystore.getPublicKey(),
    (payload) => wallet.unshieldedKeystore.signData(payload),
  );

  const finalized = await wallet.wallet.finalizeRecipe(recipe);
  return await wallet.wallet.submitTransaction(finalized);
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
