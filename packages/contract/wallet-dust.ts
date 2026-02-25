import { fileExists, hexToBytes, readFile, writeFile } from "@accountun/common";
import type { MidnightConfig, WalletContext } from "./types";
import { MidnightBech32m } from "@midnight-ntwrk/wallet-sdk-address-format";
import * as ledger from "@midnight-ntwrk/ledger-v7";
import path from "node:path";
import { getWalletState, waitForWalletSyncAdvance } from "./wallet-sync";
import { sendUnshieldedToken } from "./wallet-transfers";
import {
  buildWallet,
  getUnshieldedBalance,
  registerAvailableDustCoins,
} from "./wallet";

type DustWalletBalanceCacheState = {
  updatedAt: string;
  serviceDustAddress?: string;
  maxWalletIndex?: number;
  balances: Record<string, string>;
};

export type DustReconcileRequest = {
  dustAddress: string;
  targetSpecks: bigint;
};

export type DustReconcileAction = {
  walletIndex: number;
  op: "assign" | "rebalance" | "register" | "sweep" | "noop";
  dustAddress?: string;
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
  actions: DustReconcileAction[];
  deallocated: Array<{
    walletIndex: number;
    sweptNight: bigint;
  }>;
};

export type DustPlanExecutionResult = {
  walletIndex: number;
  op: DustReconcileAction["op"];
  dustAddress?: string;
  status: "executed" | "skipped" | "failed";
  txId?: string;
  reason?: string;
};

export type DustPlanExecutionSummary = {
  requestId: string;
  results: DustPlanExecutionResult[];
};

export type DustNetworkParameters = {
  // Maximum dust balance (Specks) per unit of NIGHT generation capacity (Star)
  nightDustRatio: bigint;
  // Derived: ceil(nightDustRatio / generationDecayRate)
  timeToCapSeconds: bigint;
  // Specks generated per Star per second
  generationDecayRate: bigint;
  dustGracePeriodSeconds: bigint;
};

type WalletBalanceSnapshot = { walletIndex: number; balanceNight: bigint };

type PlannedAllocation = DustReconcileRequest & {
  targetStars: bigint;
};

type WalletPlannedAllocation = PlannedAllocation & {
  walletIndex: number;
  currentStars: bigint;
};

const DEFAULT_DUST_TARGET_WINDOW_MS = 24 * 60 * 60 * 1000;
const DUST_BALANCE_CACHE_FILE = "dust/wallet-balances.json";

function getBalanceCachePath(config: MidnightConfig): string {
  return path.join(config.cacheDir, DUST_BALANCE_CACHE_FILE);
}

function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("Division by zero");
  return (a + b - 1n) / b;
}

function deriveTimeToCapSeconds(
  params: Pick<DustNetworkParameters, "nightDustRatio" | "generationDecayRate">,
): bigint {
  if (params.generationDecayRate <= 0n) return 0n;
  return ceilDiv(params.nightDustRatio, params.generationDecayRate);
}

function resolveGenerationWindowSeconds(targetWindowMs: number): bigint {
  const windowSeconds = BigInt(Math.max(1, Math.floor(targetWindowMs / 1000)));
  // Target midpoint of the window by default.
  return ceilDiv(windowSeconds, 2n);
}

function parseCachedBigInt(value: string | undefined): bigint | undefined {
  if (!value) return undefined;
  if (!/^[0-9]+$/.test(value)) return undefined;
  return BigInt(value);
}

function getMaxWalletIndexFromBalances(
  balances: Record<string, string>,
): number {
  let maxWalletIndex = 0;
  for (const walletIndex of Object.keys(balances)) {
    if (!/^\d+$/.test(walletIndex)) continue;
    const index = Number(walletIndex);
    if (!Number.isInteger(index) || index < 0) continue;
    if (index > maxWalletIndex) {
      maxWalletIndex = index;
    }
  }
  return maxWalletIndex;
}

function getMaxCachedWalletIndex(
  cache: DustWalletBalanceCacheState | null | undefined,
): number {
  if (!cache) return 0;

  const declaredMax =
    cache.maxWalletIndex !== undefined &&
    Number.isInteger(cache.maxWalletIndex) &&
    cache.maxWalletIndex >= 0
      ? cache.maxWalletIndex
      : 0;
  const balanceMax = getMaxWalletIndexFromBalances(cache.balances);
  return declaredMax > balanceMax ? declaredMax : balanceMax;
}

async function readDustWalletBalanceCache(
  config: MidnightConfig,
): Promise<DustWalletBalanceCacheState | null> {
  const statePath = getBalanceCachePath(config);
  if (!(await fileExists(statePath))) return null;

  try {
    const raw = await readFile(statePath);
    const parsed = JSON.parse(raw) as Partial<DustWalletBalanceCacheState>;
    if (!parsed || typeof parsed !== "object") return null;
    if (!parsed.balances || typeof parsed.balances !== "object") return null;

    return {
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date(0).toISOString(),
      serviceDustAddress:
        typeof parsed.serviceDustAddress === "string"
          ? parsed.serviceDustAddress
          : undefined,
      maxWalletIndex:
        typeof parsed.maxWalletIndex === "number" &&
        Number.isInteger(parsed.maxWalletIndex) &&
        parsed.maxWalletIndex >= 0
          ? parsed.maxWalletIndex
          : undefined,
      balances: Object.fromEntries(
        Object.entries(parsed.balances).filter(
          ([walletIndex, balance]) =>
            /^\d+$/.test(walletIndex) && typeof balance === "string",
        ),
      ),
    };
  } catch {
    return null;
  }
}

async function writeDustWalletBalanceCache(
  config: MidnightConfig,
  cache: DustWalletBalanceCacheState,
): Promise<void> {
  const payload: DustWalletBalanceCacheState = {
    ...cache,
    maxWalletIndex: Math.max(
      cache.maxWalletIndex ?? 0,
      getMaxWalletIndexFromBalances(cache.balances),
    ),
  };
  await writeFile(getBalanceCachePath(config), JSON.stringify(payload));
}

async function invalidateDustWalletBalanceCache(
  config: MidnightConfig,
  reason: string,
): Promise<void> {
  const existing = await readDustWalletBalanceCache(config);
  await writeDustWalletBalanceCache(config, {
    updatedAt: new Date().toISOString(),
    serviceDustAddress: undefined,
    maxWalletIndex: getMaxCachedWalletIndex(existing),
    balances: {},
  });
  console.warn(`[dust:cache] invalidated wallet balance cache (${reason})`);
}

function normalizeReconcileRequests(
  requests: readonly DustReconcileRequest[],
): DustReconcileRequest[] {
  if (requests.length === 0) return [];

  for (const request of requests) {
    MidnightBech32m.parse(request.dustAddress);
    if (request.targetSpecks < 0n) {
      throw new Error("targetSpecks must be >= 0");
    }
  }

  return [...requests];
}

function validateReservePercent(percent: bigint): void {
  if (percent < 0n || percent > 100n) {
    throw new Error("mainReservePercent must be between 0 and 100");
  }
}

function compareByTargetStarsDescending(
  a: Pick<PlannedAllocation, "targetStars">,
  b: Pick<PlannedAllocation, "targetStars">,
): number {
  if (a.targetStars === b.targetStars) return 0;
  return a.targetStars > b.targetStars ? -1 : 1;
}

function subtractWithFloor(a: bigint, b: bigint): bigint {
  return a > b ? a - b : 0n;
}

function takeBestFitWallet(
  availableWallets: WalletBalanceSnapshot[],
  targetStars: bigint,
): WalletBalanceSnapshot | undefined {
  let selectedIndex = -1;
  let selectedExcess: bigint | undefined;

  for (let i = 0; i < availableWallets.length; i += 1) {
    const wallet = availableWallets[i]!;
    if (wallet.balanceNight < targetStars) continue;
    const excess = wallet.balanceNight - targetStars;

    if (
      selectedIndex < 0 ||
      selectedExcess === undefined ||
      excess < selectedExcess ||
      (excess === selectedExcess &&
        wallet.walletIndex < availableWallets[selectedIndex]!.walletIndex)
    ) {
      selectedIndex = i;
      selectedExcess = excess;
    }
  }

  if (selectedIndex < 0) return undefined;
  const [wallet] = availableWallets.splice(selectedIndex, 1);
  return wallet;
}

function takeHighestBalanceWallet(
  availableWallets: WalletBalanceSnapshot[],
): WalletBalanceSnapshot | undefined {
  if (availableWallets.length === 0) return undefined;

  let selectedIndex = 0;
  for (let i = 1; i < availableWallets.length; i += 1) {
    const candidate = availableWallets[i]!;
    const selected = availableWallets[selectedIndex]!;
    if (
      candidate.balanceNight > selected.balanceNight ||
      (candidate.balanceNight === selected.balanceNight &&
        candidate.walletIndex < selected.walletIndex)
    ) {
      selectedIndex = i;
    }
  }

  const [wallet] = availableWallets.splice(selectedIndex, 1);
  return wallet;
}

function assignWalletsForAllocations(
  allocations: readonly PlannedAllocation[],
  snapshots: readonly WalletBalanceSnapshot[],
): {
  assigned: WalletPlannedAllocation[];
  unassignedWallets: WalletBalanceSnapshot[];
} {
  const orderedAllocations = [...allocations].sort(
    compareByTargetStarsDescending,
  );
  const availableWallets = [...snapshots];
  const assigned: WalletPlannedAllocation[] = [];
  const awaitingWallet: PlannedAllocation[] = [];

  for (const allocation of orderedAllocations) {
    const fundedWallet = takeBestFitWallet(
      availableWallets,
      allocation.targetStars,
    );
    if (!fundedWallet) {
      awaitingWallet.push(allocation);
      continue;
    }
    assigned.push({
      ...allocation,
      walletIndex: fundedWallet.walletIndex,
      currentStars: fundedWallet.balanceNight,
    });
  }

  for (const allocation of awaitingWallet) {
    const fallbackWallet = takeHighestBalanceWallet(availableWallets);
    if (!fallbackWallet) {
      throw new Error("Unable to assign sub-wallets to all allocations");
    }

    assigned.push({
      ...allocation,
      walletIndex: fallbackWallet.walletIndex,
      currentStars: fallbackWallet.balanceNight,
    });
  }

  return {
    assigned,
    unassignedWallets: availableWallets,
  };
}

type FundingPlanEntry = WalletPlannedAllocation & {
  deficitStars: bigint;
};

function orderAllocationsForFunding(
  assigned: readonly WalletPlannedAllocation[],
): FundingPlanEntry[] {
  return assigned
    .map((entry) => ({
      ...entry,
      deficitStars: subtractWithFloor(entry.targetStars, entry.currentStars),
    }))
    .sort((a, b) => {
      if (a.deficitStars !== b.deficitStars) {
        return a.deficitStars > b.deficitStars ? -1 : 1;
      }
      return a.walletIndex - b.walletIndex;
    });
}

function compareWalletBalanceDescending(
  a: WalletBalanceSnapshot,
  b: WalletBalanceSnapshot,
): number {
  if (a.balanceNight !== b.balanceNight) {
    return a.balanceNight > b.balanceNight ? -1 : 1;
  }
  return a.walletIndex - b.walletIndex;
}

function selectSweepWallets(
  sweepCandidates: readonly WalletBalanceSnapshot[],
  availableBudget: bigint,
  totalDeficitStars: bigint,
): WalletBalanceSnapshot[] {
  if (sweepCandidates.length === 0) {
    return [];
  }

  const ordered = [...sweepCandidates].sort(compareWalletBalanceDescending);

  const sweepNeeded = subtractWithFloor(totalDeficitStars, availableBudget);
  if (sweepNeeded === 0n) {
    return [];
  }

  const selected: WalletBalanceSnapshot[] = [];
  let reclaimed = 0n;
  for (const wallet of ordered) {
    selected.push(wallet);
    reclaimed += wallet.balanceNight;
    if (reclaimed >= sweepNeeded) {
      break;
    }
  }

  return selected;
}

async function loadSubWalletBalances(
  config: MidnightConfig,
  walletCount: number,
  timeoutMs: number,
  cachedBalanceState: DustWalletBalanceCacheState | null,
): Promise<WalletBalanceSnapshot[]> {
  const snapshots: WalletBalanceSnapshot[] = [];

  for (let walletIndex = 1; walletIndex <= walletCount; walletIndex += 1) {
    const cached = parseCachedBigInt(
      cachedBalanceState?.balances?.[walletIndex.toString()],
    );
    if (cached !== undefined) {
      snapshots.push({ walletIndex, balanceNight: cached });
      continue;
    }

    const wallet = await buildWallet(config, { accountIndex: walletIndex });
    try {
      const balanceNight = await getUnshieldedBalance(wallet, { timeoutMs });
      snapshots.push({ walletIndex, balanceNight });
    } finally {
      await wallet.wallet.stop();
    }
  }

  return snapshots;
}

export function getDefaultDustNetworkParameters(): DustNetworkParameters {
  const dustParams = ledger.LedgerParameters.initialParameters().dust;
  const nightDustRatio = dustParams.nightDustRatio;
  const generationDecayRate = dustParams.generationDecayRate;
  return {
    nightDustRatio,
    timeToCapSeconds: deriveTimeToCapSeconds({
      nightDustRatio,
      generationDecayRate,
    }),
    generationDecayRate,
    dustGracePeriodSeconds: dustParams.dustGracePeriodSeconds,
  };
}

export async function getLiveDustNetworkParameters(
  config: MidnightConfig,
  options?: { timeoutMs?: number },
): Promise<DustNetworkParameters> {
  const query = `query { block { height ledgerParameters } }`;
  const signal = options?.timeoutMs
    ? AbortSignal.timeout(options.timeoutMs)
    : undefined;
  const response = await fetch(config.indexerHttpUri, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query }),
    signal,
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ledger parameters: HTTP ${response.status}`,
    );
  }

  const payload = (await response.json()) as {
    data?: { block?: { height: number; ledgerParameters: string } | null };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors && payload.errors.length > 0) {
    const message =
      payload.errors
        .map((error) => error.message)
        .filter((message): message is string => Boolean(message))
        .join("; ") || "Unknown indexer GraphQL error";
    throw new Error(`Failed to fetch ledger parameters: ${message}`);
  }

  const encoded = payload.data?.block?.ledgerParameters;
  if (!encoded) {
    throw new Error(
      "Failed to fetch ledger parameters: block.ledgerParameters missing",
    );
  }

  const params = ledger.LedgerParameters.deserialize(hexToBytes(encoded));
  const nightDustRatio = params.dust.nightDustRatio;
  const generationDecayRate = params.dust.generationDecayRate;
  return {
    nightDustRatio,
    timeToCapSeconds: deriveTimeToCapSeconds({
      nightDustRatio,
      generationDecayRate,
    }),
    generationDecayRate,
    dustGracePeriodSeconds: params.dust.dustGracePeriodSeconds,
  };
}

export async function getDustNetworkParameters(
  config: MidnightConfig,
  options?: { timeoutMs?: number; allowFallback?: boolean },
): Promise<DustNetworkParameters> {
  try {
    return await getLiveDustNetworkParameters(config, {
      timeoutMs: options?.timeoutMs,
    });
  } catch (error) {
    if (options?.allowFallback === false) {
      throw error;
    }

    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `[dust:params] live fetch failed; using SDK defaults (${reason})`,
    );
    return getDefaultDustNetworkParameters();
  }
}

export function estimateStarsForDustTarget(
  targetSpecks: bigint,
  targetWindowMs: number,
  params: DustNetworkParameters,
): bigint {
  if (targetSpecks <= 0n) {
    throw new Error("Target Specks must be positive");
  }

  if (!Number.isFinite(targetWindowMs) || targetWindowMs <= 0) {
    throw new Error("targetWindowMs must be a positive number");
  }

  const generationWindowSeconds =
    resolveGenerationWindowSeconds(targetWindowMs);
  const uncappedSpecksPerStarAtTarget =
    params.generationDecayRate * generationWindowSeconds;
  const specksPerStarAtTarget =
    uncappedSpecksPerStarAtTarget < params.nightDustRatio
      ? uncappedSpecksPerStarAtTarget
      : params.nightDustRatio;

  if (specksPerStarAtTarget <= 0n) {
    throw new Error(
      "Dust generation rate/cap must be positive to estimate required NIGHT",
    );
  }

  return ceilDiv(targetSpecks, specksPerStarAtTarget);
}

export async function refreshDustWalletBalanceCache(
  config: MidnightConfig,
  options?: {
    timeoutMs?: number;
    maxWalletIndex?: number;
  },
): Promise<{
  updatedAt: string;
  serviceDustAddress: string;
  balances: Array<{ walletIndex: number; balanceNight: bigint }>;
}> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const cachedBalanceState = await readDustWalletBalanceCache(config);
  const maxWalletIndex = Math.max(
    options?.maxWalletIndex ?? 0,
    getMaxCachedWalletIndex(cachedBalanceState),
  );
  const balances: Array<{ walletIndex: number; balanceNight: bigint }> = [];

  const mainWallet = await buildWallet(config, { accountIndex: 0 });
  try {
    const mainState = await getWalletState(mainWallet, { timeoutMs });
    const serviceDustAddress = mainState.dust.dustAddress;
    const mainBalance = await getUnshieldedBalance(mainWallet, { timeoutMs });
    balances.push({ walletIndex: 0, balanceNight: mainBalance });

    for (let walletIndex = 1; walletIndex <= maxWalletIndex; walletIndex += 1) {
      const wallet = await buildWallet(config, { accountIndex: walletIndex });
      try {
        const balanceNight = await getUnshieldedBalance(wallet, { timeoutMs });
        balances.push({ walletIndex, balanceNight });
      } finally {
        await wallet.wallet.stop();
      }
    }

    const updatedAt = new Date().toISOString();
    await writeDustWalletBalanceCache(config, {
      updatedAt,
      serviceDustAddress,
      balances: Object.fromEntries(
        balances.map((entry) => [
          entry.walletIndex.toString(),
          entry.balanceNight.toString(),
        ]),
      ),
    });

    return {
      updatedAt,
      serviceDustAddress,
      balances,
    };
  } finally {
    await mainWallet.wallet.stop();
  }
}

export async function planDustAllocations(
  config: MidnightConfig,
  requests: readonly DustReconcileRequest[],
  options?: {
    requestId?: string;
    timeoutMs?: number;
    mainReservePercent?: bigint;
    refreshBalances?: boolean;
    targetWindowMs?: number;
  },
): Promise<DustReconcileSummary> {
  const normalized = normalizeReconcileRequests(requests);
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const reservePercent = options?.mainReservePercent ?? 50n;
  const targetWindowMs =
    options?.targetWindowMs ?? DEFAULT_DUST_TARGET_WINDOW_MS;
  const requestId =
    options?.requestId ??
    `plan-${Date.now().toString(10)}-${Math.floor(Math.random() * 1_000_000).toString(10)}`;

  validateReservePercent(reservePercent);
  if (!Number.isFinite(targetWindowMs) || targetWindowMs <= 0) {
    throw new Error("targetWindowMs must be a positive number");
  }

  let cachedBalanceState = await readDustWalletBalanceCache(config);
  const requiredWalletCount = normalized.length;
  let scannedWalletCount = Math.max(
    requiredWalletCount,
    getMaxCachedWalletIndex(cachedBalanceState),
  );

  if (options?.refreshBalances) {
    await refreshDustWalletBalanceCache(config, {
      timeoutMs,
      maxWalletIndex: scannedWalletCount,
    });
    cachedBalanceState = await readDustWalletBalanceCache(config);
    scannedWalletCount = Math.max(
      requiredWalletCount,
      getMaxCachedWalletIndex(cachedBalanceState),
    );
  }

  const mainWallet = await buildWallet(config, { accountIndex: 0 });
  try {
    const dustParams = await getDustNetworkParameters(config, {
      timeoutMs,
      allowFallback: true,
    });
    const mainState = cachedBalanceState?.serviceDustAddress
      ? undefined
      : await getWalletState(mainWallet, { timeoutMs });

    const serviceDustAddress =
      cachedBalanceState?.serviceDustAddress ?? mainState?.dust.dustAddress;
    if (!serviceDustAddress) {
      throw new Error("Unable to resolve service dust address for planning");
    }

    const cachedMainBalance = parseCachedBigInt(
      cachedBalanceState?.balances?.["0"],
    );
    const mainBalance =
      cachedMainBalance ??
      (await getUnshieldedBalance(mainWallet, { timeoutMs }));

    const snapshots = await loadSubWalletBalances(
      config,
      scannedWalletCount,
      timeoutMs,
      cachedBalanceState,
    );

    const subTotal = snapshots.reduce((sum, s) => sum + s.balanceNight, 0n);
    const totalNight = mainBalance + subTotal;
    const mainMinNight = (totalNight * reservePercent) / 100n;
    const requestedSpecks = normalized.reduce(
      (sum, req) => sum + req.targetSpecks,
      0n,
    );
    const requestedAllocations: PlannedAllocation[] = normalized.map(
      (request) => ({
        ...request,
        targetStars:
          request.targetSpecks > 0n
            ? estimateStarsForDustTarget(
                request.targetSpecks,
                targetWindowMs,
                dustParams,
              )
            : 0n,
      }),
    );

    const { assigned, unassignedWallets } = assignWalletsForAllocations(
      requestedAllocations,
      snapshots,
    );
    const fundingPlan = orderAllocationsForFunding(assigned);
    const totalDeficitStars = fundingPlan.reduce(
      (sum, entry) => sum + entry.deficitStars,
      0n,
    );
    const sweepCandidates = unassignedWallets.filter(
      (wallet) => wallet.balanceNight > 0n,
    );
    const mainSpendableBudget = subtractWithFloor(mainBalance, mainMinNight);
    const selectedSweepWallets = selectSweepWallets(
      sweepCandidates,
      mainSpendableBudget,
      totalDeficitStars,
    );
    const deallocated = selectedSweepWallets.map((wallet) => ({
      walletIndex: wallet.walletIndex,
      sweptNight: wallet.balanceNight,
    }));

    let allocatedSpecks = 0n;
    const actions: DustReconcileAction[] = selectedSweepWallets.map(
      (wallet) => ({
        walletIndex: wallet.walletIndex,
        op: "sweep",
        amountNight: wallet.balanceNight,
        reason: "Unassigned funded sub-wallet reclaimed to main wallet",
      }),
    );

    const reclaimableNight = selectedSweepWallets.reduce(
      (sum, wallet) => sum + wallet.balanceNight,
      0n,
    );
    let availableBudget = mainSpendableBudget + reclaimableNight;

    for (const entry of fundingPlan) {
      if (entry.targetSpecks === 0n) {
        actions.push({
          walletIndex: entry.walletIndex,
          op: "noop",
          dustAddress: entry.dustAddress,
          reason: "targetSpecks is zero",
        });
        continue;
      }

      const deficitStars = entry.deficitStars;
      const fundedNight =
        deficitStars === 0n
          ? 0n
          : deficitStars <= availableBudget
            ? deficitStars
            : availableBudget;

      if (fundedNight > 0n) {
        availableBudget -= fundedNight;
        actions.push({
          walletIndex: entry.walletIndex,
          op: entry.currentStars === 0n ? "assign" : "rebalance",
          dustAddress: entry.dustAddress,
          amountNight: fundedNight,
          reason:
            fundedNight < deficitStars
              ? "Partially funded due to reserve floor"
              : undefined,
        });
      } else if (deficitStars > 0n) {
        actions.push({
          walletIndex: entry.walletIndex,
          op: "rebalance",
          dustAddress: entry.dustAddress,
          amountNight: 0n,
          reason: "Main wallet reserve floor reached",
        });
      }

      const resolvedStars = entry.currentStars + fundedNight;
      if (resolvedStars > 0n) {
        actions.push({
          walletIndex: entry.walletIndex,
          op: "register",
          dustAddress: entry.dustAddress,
          reason: "Ensure wallet coins are registered to allocation receiver",
        });
      }

      if (deficitStars === 0n || fundedNight === deficitStars) {
        allocatedSpecks += entry.targetSpecks;
      }
    }

    const shortfallSpecks = requestedSpecks - allocatedSpecks;
    const cacheBalances: Record<string, string> = {
      "0": mainBalance.toString(),
      ...Object.fromEntries(
        snapshots.map((snapshot) => [
          snapshot.walletIndex.toString(),
          snapshot.balanceNight.toString(),
        ]),
      ),
    };
    await writeDustWalletBalanceCache(config, {
      updatedAt: new Date().toISOString(),
      serviceDustAddress,
      balances: cacheBalances,
    });

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
      actions,
      deallocated,
    };
  } finally {
    await mainWallet.wallet.stop();
  }
}

export async function reconcileDustAllocation(
  config: MidnightConfig,
  actions: readonly DustReconcileAction[],
  options?: {
    requestId?: string;
    timeoutMs?: number;
    continueOnError?: boolean;
  },
): Promise<DustPlanExecutionSummary> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const requestId =
    options?.requestId ??
    `execute-${Date.now().toString(10)}-${Math.floor(Math.random() * 1_000_000).toString(10)}`;
  const continueOnError = options?.continueOnError ?? false;
  const opPriority = (op: DustReconcileAction["op"]): number => {
    switch (op) {
      case "sweep":
        return 0;
      case "assign":
      case "rebalance":
        return 1;
      case "register":
        return 2;
      case "noop":
        return 3;
      default:
        return 4;
    }
  };
  const orderedActions = [...actions].sort((a, b) => {
    const opDelta = opPriority(a.op) - opPriority(b.op);
    if (opDelta !== 0) return opDelta;
    const walletDelta = a.walletIndex - b.walletIndex;
    if (walletDelta !== 0) return walletDelta;
    return (a.dustAddress ?? "").localeCompare(b.dustAddress ?? "");
  });

  const existingCache = await readDustWalletBalanceCache(config);
  const cacheBalances = new Map<number, bigint>(
    Object.entries(existingCache?.balances ?? {})
      .map(
        ([walletIndex, balance]) =>
          [Number(walletIndex), parseCachedBigInt(balance)] as const,
      )
      .filter((entry): entry is [number, bigint] => entry[1] !== undefined),
  );

  const mainWallet = await buildWallet(config, { accountIndex: 0 });
  const walletCache = new Map([[0, mainWallet]]);
  const results: DustPlanExecutionResult[] = [];

  const getWallet = async (walletIndex: number): Promise<WalletContext> => {
    const cached = walletCache.get(walletIndex);
    if (cached) {
      return cached;
    }

    const wallet = await buildWallet(config, { accountIndex: walletIndex });
    walletCache.set(walletIndex, wallet);
    return wallet;
  };

  try {
    try {
      const mainAddress = mainWallet.unshieldedKeystore
        .getBech32Address()
        .toString();
      const transferBetweenWallets = async (
        sourceWallet: WalletContext,
        targetWallet: WalletContext,
        receiverAddress: string,
        amountNight: bigint,
      ): Promise<string> => {
        const [sourceBaseline, targetBaseline] = await Promise.all([
          getWalletState(sourceWallet, { timeoutMs }),
          getWalletState(targetWallet, { timeoutMs }),
        ]);

        const txId = await sendUnshieldedToken(
          sourceWallet,
          receiverAddress,
          amountNight,
        );

        await waitForWalletSyncAdvance(sourceWallet, {
          baselineState: sourceBaseline,
          timeoutMs,
          txId,
        });
        await waitForWalletSyncAdvance(targetWallet, {
          baselineState: targetBaseline,
          timeoutMs,
          txId,
        });

        return txId;
      };

      for (const action of orderedActions) {
        try {
          if (action.op === "noop") {
            results.push({
              walletIndex: action.walletIndex,
              op: action.op,
              dustAddress: action.dustAddress,
              status: "skipped",
              reason: action.reason ?? "No action required",
            });
            continue;
          }

          if (
            (action.op === "assign" ||
              action.op === "rebalance" ||
              action.op === "sweep") &&
            (action.amountNight === undefined || action.amountNight <= 0n)
          ) {
            results.push({
              walletIndex: action.walletIndex,
              op: action.op,
              dustAddress: action.dustAddress,
              status: "skipped",
              reason: action.reason ?? "Amount was zero",
            });
            continue;
          }

          if (action.op === "register") {
            const targetWallet = await getWallet(action.walletIndex);
            if (!action.dustAddress) {
              throw new Error(
                "Register action missing dustAddress receiver",
              );
            }

            const registration = await registerAvailableDustCoins(
              targetWallet,
              {
                dustReceiverAddress: action.dustAddress,
                timeoutMs,
                awaitConfirmation: true,
              },
            );

            if (!registration) {
              results.push({
                walletIndex: action.walletIndex,
                op: action.op,
                dustAddress: action.dustAddress,
                status: "skipped",
                reason: "No eligible NIGHT coins to register",
              });
              continue;
            }

            results.push({
              walletIndex: action.walletIndex,
              op: action.op,
              dustAddress: action.dustAddress,
              status: "executed",
              txId: registration.txId,
            });
            continue;
          }

          if (action.op === "assign" || action.op === "rebalance") {
            const targetWallet = await getWallet(action.walletIndex);
            const receiverAddress = targetWallet.unshieldedKeystore
              .getBech32Address()
              .toString();
            const txId = await transferBetweenWallets(
              mainWallet,
              targetWallet,
              receiverAddress,
              action.amountNight!,
            );

            results.push({
              walletIndex: action.walletIndex,
              op: action.op,
              dustAddress: action.dustAddress,
              status: "executed",
              txId,
            });
            cacheBalances.set(
              action.walletIndex,
              (cacheBalances.get(action.walletIndex) ?? 0n) +
                action.amountNight!,
            );
            cacheBalances.set(
              0,
              (cacheBalances.get(0) ?? 0n) - action.amountNight!,
            );
            continue;
          }

          if (action.op === "sweep") {
            const sourceWallet = await getWallet(action.walletIndex);
            const txId = await transferBetweenWallets(
              sourceWallet,
              mainWallet,
              mainAddress,
              action.amountNight!,
            );

            results.push({
              walletIndex: action.walletIndex,
              op: action.op,
              dustAddress: action.dustAddress,
              status: "executed",
              txId,
            });
            cacheBalances.set(
              action.walletIndex,
              (cacheBalances.get(action.walletIndex) ?? 0n) -
                action.amountNight!,
            );
            cacheBalances.set(
              0,
              (cacheBalances.get(0) ?? 0n) + action.amountNight!,
            );
            continue;
          }

          results.push({
            walletIndex: action.walletIndex,
            op: action.op,
            dustAddress: action.dustAddress,
            status: "skipped",
            reason: "Unsupported operation",
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          const failure: DustPlanExecutionResult = {
            walletIndex: action.walletIndex,
            op: action.op,
            dustAddress: action.dustAddress,
            status: "failed",
            reason,
          };
          results.push(failure);

          if (!continueOnError) {
            throw new Error(
              `Failed to execute action ${action.op} for wallet ${action.walletIndex}: ${reason}`,
            );
          }
        }
      }

      if (results.some((result) => result.status === "failed")) {
        await invalidateDustWalletBalanceCache(
          config,
          `execution request ${requestId} had failed actions`,
        );
        return {
          requestId,
          results,
        };
      }

      await writeDustWalletBalanceCache(config, {
        updatedAt: new Date().toISOString(),
        serviceDustAddress: existingCache?.serviceDustAddress,
        balances: Object.fromEntries(
          [...cacheBalances.entries()]
            .filter(([walletIndex]) => walletIndex >= 0)
            .map(([walletIndex, balance]) => [
              walletIndex.toString(),
              balance.toString(),
            ]),
        ),
      });

      return {
        requestId,
        results,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      try {
        await invalidateDustWalletBalanceCache(
          config,
          `execution request ${requestId} threw: ${reason}`,
        );
      } catch (invalidateError) {
        console.warn(
          `[dust:cache] failed to invalidate wallet balance cache after error: ${String(invalidateError)}`,
        );
      }
      throw error;
    }
  } finally {
    for (const [walletIndex, wallet] of walletCache) {
      try {
        await wallet.wallet.stop();
      } catch {
        console.warn(
          `[dust:execute] failed to stop wallet index=${walletIndex} cleanly`,
        );
      }
    }
  }
}

export async function estimateCoinAmountForDustTarget(
  targetSpecks: bigint,
  options?: {
    targetWindowMs?: number;
    params?: DustNetworkParameters;
    config?: MidnightConfig;
    timeoutMs?: number;
  },
): Promise<bigint> {
  const targetWindowMs =
    options?.targetWindowMs ?? DEFAULT_DUST_TARGET_WINDOW_MS;
  const params =
    options?.params ??
    (options?.config
      ? await getDustNetworkParameters(options.config, {
          timeoutMs: options.timeoutMs,
          allowFallback: true,
        })
      : getDefaultDustNetworkParameters());

  return estimateStarsForDustTarget(targetSpecks, targetWindowMs, params);
}
