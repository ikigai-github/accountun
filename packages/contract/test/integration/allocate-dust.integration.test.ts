import { describe, expect, it } from "bun:test";
import {
  buildWallet,
  getWalletState,
  reconcileDustAllocations,
} from "../../index";
import { buildIntegrationConfig } from "./config";
import { createDustAllocationFixture } from "./fixtures/dust-allocation";

describe("dust allocation integration", () => {
  it("plans dust reconcile for fixture requests", async () => {
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

    const summary = await reconcileDustAllocations(config, fixture.requests, {
      requestId: "integration-reconcile-plan",
      mainReservePercent: 50n,
      dryRun: true,
      timeoutMs: 240_000,
    });

    expect(summary.requestId).toBe("integration-reconcile-plan");
    expect(summary.dryRun).toBe(true);
    expect(summary.requestedSpecks).toBe(1_000n);
    expect(summary.allocatedSpecks >= 0n).toBe(true);
    expect(summary.shortfallSpecks >= 0n).toBe(true);
    expect(summary.actions.length > 0).toBe(true);
  });
});
