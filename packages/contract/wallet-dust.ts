import { fileExists, hexToBytes, readFile, writeFile } from "@accountun/common";
import type { MidnightConfig, WalletContext } from "./types";
import { MidnightBech32m } from "@midnight-ntwrk/wallet-sdk-address-format";
import * as ledger from "@midnight-ntwrk/ledger-v7";
import path from "node:path";
import {
  getWalletState,
  type WalletState,
  waitForWalletSyncAdvance,
} from "./wallet-sync";
import { sendUnshieldedToken } from "./wallet-transfers";
import {
  buildWallet,
  getUnshieldedBalance,
  registerAvailableDustCoins,
} from "./wallet";

type DustWalletBalanceCacheState = {
  updatedAt: string;
  serviceDustAddress?: string;
  balances: Record<string, string>;
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
  actions: DustReconcileAction[];
  deallocated: Array<{
    walletIndex: number;
    sweptNight: bigint;
  }>;
};

export type DustPlanExecutionResult = {
  allocationId: string;
  walletIndex: number;
  op: DustReconcileAction["op"];
  status: "executed" | "skipped" | "failed";
  txId?: string;
  reason?: string;
};

export type DustPlanExecutionSummary = {
  requestId: string;
  results: DustPlanExecutionResult[];
};

export type DustNetworkParameters = {
  nightDustRatio: bigint;
  timeToCapSeconds: bigint;
  generationDecayRate: bigint;
  dustGracePeriodSeconds: bigint;
};

const DEFAULT_DUST_TARGET_WINDOW_MS = 60 * 60 * 1000;
const DUST_BALANCE_CACHE_FILE = "dust/wallet-balances.json";

function getBalanceCachePath(config: MidnightConfig): string {
  return path.join(config.cacheDir, DUST_BALANCE_CACHE_FILE);
}

function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("Division by zero");
  return (a + b - 1n) / b;
}

function parseCachedBigInt(value: string | undefined): bigint | undefined {
  if (!value) return undefined;
  if (!/^[0-9]+$/.test(value)) return undefined;
  return BigInt(value);
}

function getMaxCachedWalletIndex(
  cache: DustWalletBalanceCacheState | null | undefined,
): number {
  if (!cache) return 0;

  let maxWalletIndex = 0;
  for (const walletIndex of Object.keys(cache.balances)) {
    if (!/^\d+$/.test(walletIndex)) continue;
    const index = Number(walletIndex);
    if (!Number.isInteger(index) || index < 0) continue;
    if (index > maxWalletIndex) {
      maxWalletIndex = index;
    }
  }

  return maxWalletIndex;
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
  await writeFile(getBalanceCachePath(config), JSON.stringify(cache));
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

export function getDefaultDustNetworkParameters(): DustNetworkParameters {
  const dustParams = ledger.LedgerParameters.initialParameters().dust;
  return {
    nightDustRatio: dustParams.nightDustRatio,
    timeToCapSeconds: dustParams.timeToCapSeconds,
    generationDecayRate: dustParams.generationDecayRate,
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
  return {
    nightDustRatio: params.dust.nightDustRatio,
    timeToCapSeconds: params.dust.timeToCapSeconds,
    generationDecayRate: params.dust.generationDecayRate,
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

export function estimateNightForDustTarget(
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

  const effectiveWindowSeconds = BigInt(
    Math.max(1, Math.floor(targetWindowMs / 1000)),
  );
  const grace = params.dustGracePeriodSeconds;
  const activeSeconds =
    effectiveWindowSeconds > grace ? effectiveWindowSeconds - grace : 1n;
  const capSeconds =
    params.timeToCapSeconds > 0n ? params.timeToCapSeconds : 1n;

  const scaledCapPerNight =
    (params.nightDustRatio * activeSeconds) / capSeconds;
  const effectiveCapPerNight = scaledCapPerNight > 0n ? scaledCapPerNight : 1n;

  return ceilDiv(targetSpecks, effectiveCapPerNight);
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

  console.info(
    `[dust:plan] requestId=${requestId} normalizedAllocations=${normalized.length} reservePercent=${reservePercent.toString()} targetWindowMs=${targetWindowMs}`,
  );
  if (normalized.length > 0) {
    console.info("[dust:plan] normalized allocations:");
    for (const allocation of normalized) {
      console.info(
        `  - id=${allocation.allocationId} targetSpecks=${allocation.targetSpecks.toString()} dustAddress=${allocation.dustAddress} priority=${allocation.priority ?? ""}`,
      );
    }
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
    let mainState: WalletState | undefined;

    if (!cachedBalanceState?.serviceDustAddress) {
      mainState = await getWalletState(mainWallet, { timeoutMs });
    }

    const dustParams = await getDustNetworkParameters(config, {
      timeoutMs,
      allowFallback: true,
    });

    const serviceDustAddress =
      cachedBalanceState?.serviceDustAddress ??
      mainState?.dust.dustAddress ??
      "";
    if (!serviceDustAddress) {
      throw new Error("Unable to resolve service dust address for planning");
    }

    const cachedMainBalance = parseCachedBigInt(
      cachedBalanceState?.balances?.["0"],
    );
    const mainBalance =
      cachedMainBalance ??
      (await getUnshieldedBalance(mainWallet, { timeoutMs }));

    const snapshots: Array<{ walletIndex: number; balanceNight: bigint }> = [];
    for (let i = 0; i < scannedWalletCount; i += 1) {
      const walletIndex = i + 1;
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

    console.info(
      `[dust:plan] wallet balances: main(index=0)=${mainBalance.toString()} subWalletTotal=${subTotal.toString()} totalNight=${totalNight.toString()} mainMinNight=${mainMinNight.toString()} spendableFromMain=${spendableFromMain.toString()}`,
    );
    if (snapshots.length > 0) {
      console.info("[dust:plan] sub-wallet balances:");
      for (const snapshot of snapshots) {
        console.info(
          `  - walletIndex=${snapshot.walletIndex} balanceNight=${snapshot.balanceNight.toString()}`,
        );
      }
    }

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
          targetNight = estimateNightForDustTarget(
            req.targetSpecks,
            targetWindowMs,
            dustParams,
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

    const changedWalletActions = actions.filter(
      (action) =>
        (action.op === "assign" ||
          action.op === "rebalance" ||
          action.op === "sweep") &&
        action.amountNight !== undefined &&
        action.amountNight > 0n,
    );

    if (changedWalletActions.length > 0) {
      console.info("[dust:plan] planned wallet balance changes:");
      for (const action of changedWalletActions) {
        console.info(
          `  - allocationId=${action.allocationId} walletIndex=${action.walletIndex} op=${action.op} amountNight=${action.amountNight?.toString()}${action.reason ? ` reason=${action.reason}` : ""}`,
        );
      }
    } else {
      console.info("[dust:plan] planned wallet balance changes: none");
    }

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
    requests?: readonly DustReconcileRequest[];
    continueOnError?: boolean;
  },
): Promise<DustPlanExecutionSummary> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const requestId =
    options?.requestId ??
    `execute-${Date.now().toString(10)}-${Math.floor(Math.random() * 1_000_000).toString(10)}`;
  const continueOnError = options?.continueOnError ?? false;
  const normalizedRequests = options?.requests
    ? normalizeReconcileRequests(options.requests)
    : [];
  const dustAddressByAllocationId = new Map<string, string>(
    normalizedRequests.map((request) => [
      request.allocationId,
      request.dustAddress,
    ]),
  );
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
    const priorityDelta = opPriority(a.op) - opPriority(b.op);
    if (priorityDelta !== 0) return priorityDelta;
    const walletDelta = a.walletIndex - b.walletIndex;
    if (walletDelta !== 0) return walletDelta;
    return a.allocationId.localeCompare(b.allocationId);
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

  console.info(
    `[dust:execute] requestId=${requestId} actions=${actions.length} orderedActions=${orderedActions.length} continueOnError=${continueOnError}`,
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
    const mainAddress = mainWallet.unshieldedKeystore
      .getBech32Address()
      .toString();

    for (const action of orderedActions) {
      try {
        if (action.op === "noop") {
          results.push({
            allocationId: action.allocationId,
            walletIndex: action.walletIndex,
            op: action.op,
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
            allocationId: action.allocationId,
            walletIndex: action.walletIndex,
            op: action.op,
            status: "skipped",
            reason: action.reason ?? "Amount was zero",
          });
          continue;
        }

        if (action.op === "register") {
          const targetWallet = await getWallet(action.walletIndex);
          const dustReceiverAddress = dustAddressByAllocationId.get(
            action.allocationId,
          );

          const registration = await registerAvailableDustCoins(targetWallet, {
            dustReceiverAddress,
            timeoutMs,
            awaitConfirmation: true,
          });

          if (!registration) {
            results.push({
              allocationId: action.allocationId,
              walletIndex: action.walletIndex,
              op: action.op,
              status: "skipped",
              reason: "No eligible NIGHT coins to register",
            });
            continue;
          }

          results.push({
            allocationId: action.allocationId,
            walletIndex: action.walletIndex,
            op: action.op,
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
          const senderBaseline = await getWalletState(mainWallet, {
            timeoutMs,
          });
          const receiverBaseline = await getWalletState(targetWallet, {
            timeoutMs,
          });

          const txId = await sendUnshieldedToken(
            mainWallet,
            receiverAddress,
            action.amountNight!,
          );

          await waitForWalletSyncAdvance(mainWallet, {
            baselineState: senderBaseline,
            timeoutMs,
            txId,
          });
          await waitForWalletSyncAdvance(targetWallet, {
            baselineState: receiverBaseline,
            timeoutMs,
            txId,
          });

          results.push({
            allocationId: action.allocationId,
            walletIndex: action.walletIndex,
            op: action.op,
            status: "executed",
            txId,
          });
          cacheBalances.set(
            action.walletIndex,
            (cacheBalances.get(action.walletIndex) ?? 0n) + action.amountNight!,
          );
          cacheBalances.set(
            0,
            (cacheBalances.get(0) ?? 0n) - action.amountNight!,
          );
          continue;
        }

        if (action.op === "sweep") {
          const sourceWallet = await getWallet(action.walletIndex);
          const sourceBaseline = await getWalletState(sourceWallet, {
            timeoutMs,
          });
          const receiverBaseline = await getWalletState(mainWallet, {
            timeoutMs,
          });

          const txId = await sendUnshieldedToken(
            sourceWallet,
            mainAddress,
            action.amountNight!,
          );

          await waitForWalletSyncAdvance(sourceWallet, {
            baselineState: sourceBaseline,
            timeoutMs,
            txId,
          });
          await waitForWalletSyncAdvance(mainWallet, {
            baselineState: receiverBaseline,
            timeoutMs,
            txId,
          });

          results.push({
            allocationId: action.allocationId,
            walletIndex: action.walletIndex,
            op: action.op,
            status: "executed",
            txId,
          });
          cacheBalances.set(
            action.walletIndex,
            (cacheBalances.get(action.walletIndex) ?? 0n) - action.amountNight!,
          );
          cacheBalances.set(
            0,
            (cacheBalances.get(0) ?? 0n) + action.amountNight!,
          );
          continue;
        }

        results.push({
          allocationId: action.allocationId,
          walletIndex: action.walletIndex,
          op: action.op,
          status: "skipped",
          reason: "Unsupported operation",
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const failure: DustPlanExecutionResult = {
          allocationId: action.allocationId,
          walletIndex: action.walletIndex,
          op: action.op,
          status: "failed",
          reason,
        };
        results.push(failure);

        if (!continueOnError) {
          throw new Error(
            `Failed to execute action ${action.op} for allocation '${action.allocationId}' (wallet ${action.walletIndex}): ${reason}`,
          );
        }
      }
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

  return estimateNightForDustTarget(targetSpecks, targetWindowMs, params);
}
