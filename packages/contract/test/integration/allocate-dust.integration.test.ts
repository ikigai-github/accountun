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

describe("dust allocation integration", () => {
  it("reconciles dust allocations across rounds with sweep and register behavior", async () => {
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
        targetSpecks: 400n,
      },
      {
        ...fixture.requests[1]!,
        targetSpecks: 700n,
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
      timeoutMs: ROUND_TIMEOUT_MS,
    });

    expect(roundOneSummary.requestId).toBe("integration-reconcile-round1-plan");
    expect(roundOneSummary.requestedSpecks).toBe(1_100n);
    expect(roundOneSummary.actions.length >= 2).toBe(true);

    const roundOneExecution = await reconcileDustAllocation(
      config,
      roundOneSummary.actions,
      {
        requestId: "integration-reconcile-round1-execute",
        timeoutMs: ROUND_TIMEOUT_MS,
        continueOnError: false,
      },
    );

    expect(roundOneExecution.requestId).toBe("integration-reconcile-round1-execute");
    expect(roundOneExecution.results.length).toBe(roundOneSummary.actions.length);
    expect(
      roundOneExecution.results.every((result) => result.status !== "failed"),
    ).toBe(true);
    assertExecutionOrder(roundOneExecution.results);
    const keepRequest = roundOneRequests[0]!;

    const roundTwoSummary = await planDustAllocations(config, [keepRequest], {
      requestId: "integration-reconcile-round2-plan",
      mainReservePercent: 0n,
      targetWindowMs: TARGET_WINDOW_MS,
      timeoutMs: ROUND_TIMEOUT_MS,
    });

    const registerAction = roundTwoSummary.actions.find(
      (action) => action.op === "register",
    );
    expect(Boolean(registerAction)).toBe(true);

    const registerActionIndex = roundTwoSummary.actions.findIndex(
      (action) => action.op === "register",
    );
    const sweepActionIndex = roundTwoSummary.actions.findIndex(
      (action) => action.op === "sweep",
    );
    expect(registerActionIndex >= 0).toBe(true);
    if (sweepActionIndex >= 0) {
      expect(sweepActionIndex < registerActionIndex).toBe(true);
    }
  });

});
