import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import type { MidnightConfig } from "../../types";
import {
  buildWallet,
  getUnshieldedBalance,
  getWalletState,
  rebalanceNight,
} from "../../wallet";

const packageDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function buildLocalConfig(seedHex: string): MidnightConfig {
  return {
    cacheDir: path.join(packageDir, ".cache", "integration"),
    authSecret: new Uint8Array(16).fill(7),
    serviceWalletSeedHex: seedHex,
    network: (process.env.NETWORK ?? "undeployed") as MidnightConfig["network"],
    substrateNodeUri: process.env.SUBSTRATE_NODE_URI ?? "http://127.0.0.1:9944",
    indexerHttpUri:
      process.env.INDEXER_HTTP_URI ?? "http://127.0.0.1:8088/api/v3/graphql",
    indexerWsUri:
      process.env.INDEXER_WS_URI ?? "ws://127.0.0.1:8088/api/v3/graphql/ws",
    proofServerUri: process.env.PROOF_SERVER_URI ?? "http://127.0.0.1:6300",
  };
}

async function waitForBalanceAtLeast(
  wallet: Awaited<ReturnType<typeof buildWallet>>,
  minBalance: bigint,
  timeoutMs = 90_000,
): Promise<bigint> {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const balance = await getUnshieldedBalance(wallet, { timeoutMs: 60_000 });
    console.info(`[integration] balance check: ${balance.toString()}`);
    if (balance >= minBalance) return balance;
    if (Date.now() > deadline) {
      throw new Error(
        `Timed out waiting for balance >= ${minBalance.toString()}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
}

describe("wallet integration", () => {
  it("splits coins, then merges", async () => {
    const seedHex = process.env.SERVICE_WALLET_SEED_HEX;
    if (!seedHex) {
      throw new Error("SERVICE_WALLET_SEED_HEX must be set");
    }

    const config = buildLocalConfig(seedHex);
    console.info(
      `[integration] endpoints: node=${config.substrateNodeUri} indexer=${config.indexerHttpUri} proof=${config.proofServerUri}`,
    );
    let wallet = await buildWallet(config);
    try {
      const minBalance = 10_000_000n;
      const balance = await waitForBalanceAtLeast(wallet, minBalance, 90_000);

      const beforeSplit = await getWalletState(wallet, { timeoutMs: 120_000 });
      const beforeSplitCount = beforeSplit.unshielded.availableCoins.length;
      console.info(
        `[integration] before split coin count: ${beforeSplitCount}`,
      );

      const splitAmount = balance / 50n;
      if (splitAmount <= 0n) {
        throw new Error("Balance too low to split into coins");
      }

      console.info("[integration] splitting coins");
      await rebalanceNight(wallet, [splitAmount, splitAmount, splitAmount]);

      const afterSplit = await getWalletState(wallet, { timeoutMs: 120_000 });
      const afterSplitCount = afterSplit.unshielded.availableCoins.length;
      console.info(`[integration] after split coin count: ${afterSplitCount}`);

      // Rebuild wallet between transactions to force fresh coin selection state.
      await wallet.wallet.stop();
      wallet = await buildWallet(config);
      await getWalletState(wallet, { timeoutMs: 120_000 });

      console.info("[integration] merging coins");
      const mergeAmount = splitAmount * 3n;
      await rebalanceNight(wallet, [mergeAmount]);

      const afterMerge = await getWalletState(wallet, { timeoutMs: 120_000 });
      const afterMergeCount = afterMerge.unshielded.availableCoins.length;
      console.info(`[integration] after merge coin count: ${afterMergeCount}`);
    } catch (error) {
      console.error("[integration] test error:", error);
      throw error;
    } finally {
      await wallet.wallet.stop();
    }
  });
});
