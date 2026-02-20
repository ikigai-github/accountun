import { describe, expect, it } from "bun:test";
import {
  buildWallet,
  getWalletState,
  planDustAllocations,
  reconcileDustAllocation,
} from "../../index";
import { buildIntegrationConfig } from "./config";
import { createDustAllocationFixture } from "./fixtures/dust-allocation";

describe("dust allocation integration", () => {
  it("plans and executes dust reconcile for fixture requests", async () => {
    const seedHex = process.env.SERVICE_WALLET_SEED_HEX;
    if (!seedHex) {
      throw new Error("SERVICE_WALLET_SEED_HEX must be set");
    }

    const config = buildIntegrationConfig(seedHex);
    const fixture = createDustAllocationFixture();

    console.info(
      `[integration] endpoints: node=${config.substrateNodeUri} indexer=${config.indexerHttpUri} proof=${config.proofServerUri}`,
    );

    const wallet = await buildWallet(config);
    try {
      const state = await getWalletState(wallet, { timeoutMs: 120_000 });
      const dustBalance = state.dust.walletBalance(new Date());
      console.info(
        `[integration] dust balance before: ${dustBalance.toString()}`,
      );
    } finally {
      await wallet.wallet.stop();
    }

    const summary = await planDustAllocations(config, fixture.requests, {
      requestId: "integration-reconcile-plan",
      mainReservePercent: 50n,
      targetWindowMs: 60 * 60 * 1000,
      timeoutMs: 240_000,
    });

    expect(summary.requestId).toBe("integration-reconcile-plan");
    expect(summary.requestedSpecks).toBe(3_000n);
    expect(summary.allocatedSpecks >= 0n).toBe(true);
    expect(summary.shortfallSpecks >= 0n).toBe(true);
    expect(summary.actions.length >= 2).toBe(true);

    const execution = await reconcileDustAllocation(config, summary.actions, {
      requestId: "integration-reconcile-execute",
      timeoutMs: 240_000,
      requests: fixture.requests,
      continueOnError: false,
    });

    expect(execution.requestId).toBe("integration-reconcile-execute");
    expect(execution.results.length).toBe(summary.actions.length);
    expect(
      execution.results.every((result) => result.status !== "failed"),
    ).toBe(true);
  });
});
