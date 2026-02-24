import { describe, expect, it } from "bun:test";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  buildWallet,
  estimateCoinAmountForDustTarget,
  getUnshieldedBalance,
  getWalletState,
  planDustAllocations,
  reconcileDustAllocation,
  type DustPlanExecutionResult,
  type DustReconcileAction,
  type DustReconcileRequest,
  type MidnightConfig,
} from "../../index";
import { buildIntegrationConfig } from "./config";
import { createDustAllocationFixture } from "./fixtures/dust-allocation";

const TARGET_WINDOW_MS = 60 * 60 * 1000;
const ROUND_TIMEOUT_MS = 300_000;
const PEAK_POSITION = "end" as const;

const OP_ORDER: Record<DustReconcileAction["op"], number> = {
  sweep: 0,
  assign: 1,
  rebalance: 1,
  register: 2,
  noop: 3,
};

function assertExecutionOrder(results: readonly DustPlanExecutionResult[]): void {
  for (let i = 1; i < results.length; i += 1) {
    const previous = results[i - 1]!;
    const current = results[i]!;
    expect(OP_ORDER[current.op] >= OP_ORDER[previous.op]).toBe(true);
  }
}

function firstActionForAllocation(
  actions: readonly DustReconcileAction[],
  allocationId: string,
): DustReconcileAction | undefined {
  return actions.find((action) => action.allocationId === allocationId);
}

function firstActionIndexForAllocation(
  actions: readonly DustReconcileAction[],
  allocationId: string,
): number {
  return actions.findIndex((action) => action.allocationId === allocationId);
}

async function getWalletNightBalance(
  config: MidnightConfig,
  walletIndex: number,
): Promise<bigint> {
  const wallet = await buildWallet(config, { accountIndex: walletIndex });
  try {
    return await getUnshieldedBalance(wallet, { timeoutMs: 120_000 });
  } finally {
    await wallet.wallet.stop();
  }
}

describe("dust allocation integration", () => {
  it("reconciles dust allocations across rounds with priority, sweep, and register behavior", async () => {
    const seedHex = process.env.SERVICE_WALLET_SEED_HEX;
    if (!seedHex) {
      throw new Error("SERVICE_WALLET_SEED_HEX must be set");
    }

    const baseConfig = buildIntegrationConfig(seedHex);
    const config: MidnightConfig = {
      ...baseConfig,
      cacheDir: path.join(
        baseConfig.cacheDir,
        `allocate-dust-${Date.now()}-${randomUUID()}`,
      ),
    };
    const fixture = createDustAllocationFixture();
    if (fixture.requests.length < 2) {
      throw new Error("dust allocation fixture must include at least 2 requests");
    }

    const roundOneRequests: DustReconcileRequest[] = [
      {
        ...fixture.requests[0]!,
        allocationId: "integration-allocation-low-priority",
        targetSpecks: 400n,
        priority: 2,
      },
      {
        ...fixture.requests[1]!,
        allocationId: "integration-allocation-high-priority",
        targetSpecks: 700n,
        priority: 1,
      },
    ];

    console.info(
      `[integration] endpoints: node=${config.substrateNodeUri} indexer=${config.indexerHttpUri} proof=${config.proofServerUri}`,
    );

    let mainBalance = 0n;
    const wallet = await buildWallet(config);
    try {
      const [state, balance] = await Promise.all([
        getWalletState(wallet, { timeoutMs: 120_000 }),
        getUnshieldedBalance(wallet, { timeoutMs: 120_000 }),
      ]);
      const dustBalance = state.dust.walletBalance(new Date());
      mainBalance = balance;
      console.info(
        `[integration] dust balance before: ${dustBalance.toString()} unshielded NIGHT: ${mainBalance.toString()}`,
      );
    } finally {
      await wallet.wallet.stop();
    }

    if (mainBalance <= 0n) {
      throw new Error("integration wallet must have a positive NIGHT balance");
    }

    const estimatedRoundOneNight = (
      await Promise.all(
        roundOneRequests.map((request) =>
          estimateCoinAmountForDustTarget(request.targetSpecks, {
            config,
            targetWindowMs: TARGET_WINDOW_MS,
            targetPeakPosition: PEAK_POSITION,
            timeoutMs: 120_000,
          }),
        ),
      )
    ).reduce((sum, required) => sum + required, 0n);

    if (estimatedRoundOneNight <= 0n) {
      throw new Error("failed to estimate required NIGHT for round one targets");
    }

    const roundOneSummary = await planDustAllocations(config, roundOneRequests, {
      requestId: "integration-reconcile-round1-plan",
      mainReservePercent: 0n,
      refreshBalances: true,
      targetWindowMs: TARGET_WINDOW_MS,
      targetPeakPosition: PEAK_POSITION,
      timeoutMs: ROUND_TIMEOUT_MS,
    });

    expect(roundOneSummary.requestId).toBe("integration-reconcile-round1-plan");
    expect(roundOneSummary.requestedSpecks).toBe(1_100n);
    expect(roundOneSummary.actions.length >= 2).toBe(true);

    const highPriorityActionIndex = firstActionIndexForAllocation(
      roundOneSummary.actions,
      "integration-allocation-high-priority",
    );
    const lowPriorityActionIndex = firstActionIndexForAllocation(
      roundOneSummary.actions,
      "integration-allocation-low-priority",
    );
    expect(highPriorityActionIndex >= 0).toBe(true);
    expect(lowPriorityActionIndex >= 0).toBe(true);
    expect(highPriorityActionIndex < lowPriorityActionIndex).toBe(true);

    const roundOneExecution = await reconcileDustAllocation(
      config,
      roundOneSummary.actions,
      {
        requestId: "integration-reconcile-round1-execute",
        timeoutMs: ROUND_TIMEOUT_MS,
        requests: roundOneRequests,
        continueOnError: false,
      },
    );

    expect(roundOneExecution.requestId).toBe("integration-reconcile-round1-execute");
    expect(roundOneExecution.results.length).toBe(roundOneSummary.actions.length);
    expect(
      roundOneExecution.results.every((result) => result.status !== "failed"),
    ).toBe(true);
    assertExecutionOrder(roundOneExecution.results);

    const highPriorityAction = firstActionForAllocation(
      roundOneSummary.actions,
      "integration-allocation-high-priority",
    );
    const lowPriorityAction = firstActionForAllocation(
      roundOneSummary.actions,
      "integration-allocation-low-priority",
    );
    if (!highPriorityAction || !lowPriorityAction) {
      throw new Error("round one plan did not include both test allocations");
    }

    const highPriorityWalletBalance = await getWalletNightBalance(
      config,
      highPriorityAction.walletIndex,
    );
    const lowPriorityWalletBalance = await getWalletNightBalance(
      config,
      lowPriorityAction.walletIndex,
    );

    const dropTarget =
      highPriorityWalletBalance >= lowPriorityWalletBalance
        ? {
            request: roundOneRequests[1]!,
            walletIndex: highPriorityAction.walletIndex,
            balanceNight: highPriorityWalletBalance,
          }
        : {
            request: roundOneRequests[0]!,
            walletIndex: lowPriorityAction.walletIndex,
            balanceNight: lowPriorityWalletBalance,
          };
    const keepRequest = roundOneRequests.find(
      (request) => request.allocationId !== dropTarget.request.allocationId,
    );

    if (!keepRequest) {
      throw new Error("failed to resolve keep allocation for round two");
    }
    if (dropTarget.balanceNight <= 0n) {
      throw new Error(
        "expected at least one funded sub-wallet after round one execution",
      );
    }

    const roundTwoSummary = await planDustAllocations(config, [keepRequest], {
      requestId: "integration-reconcile-round2-plan",
      mainReservePercent: 0n,
      targetWindowMs: TARGET_WINDOW_MS,
      targetPeakPosition: PEAK_POSITION,
      timeoutMs: ROUND_TIMEOUT_MS,
    });

    const sweepAction = roundTwoSummary.actions.find(
      (action) =>
        action.op === "sweep" &&
        action.walletIndex === dropTarget.walletIndex &&
        action.amountNight !== undefined &&
        action.amountNight > 0n,
    );
    expect(Boolean(sweepAction)).toBe(true);

    const registerAction = roundTwoSummary.actions.find(
      (action) =>
        action.allocationId === keepRequest.allocationId &&
        action.op === "register",
    );
    expect(Boolean(registerAction)).toBe(true);

    const sweepActionIndex = roundTwoSummary.actions.findIndex(
      (action) =>
        action.op === "sweep" && action.walletIndex === dropTarget.walletIndex,
    );
    const registerActionIndex = roundTwoSummary.actions.findIndex(
      (action) =>
        action.op === "register" &&
        action.allocationId === keepRequest.allocationId,
    );
    expect(sweepActionIndex >= 0).toBe(true);
    expect(registerActionIndex >= 0).toBe(true);
    expect(sweepActionIndex < registerActionIndex).toBe(true);
  });

});
