import { describe, it } from "bun:test";
import {
  buildWallet,
  getUnshieldedBalance,
  getWalletState,
  rebalanceUnshieldedNightCoins,
} from "../../wallet";
import { buildIntegrationConfig } from "./config";

function hasWalletTransactingTag(error: unknown): boolean {
  const seen = new Set<unknown>();

  function visit(value: unknown, depth: number): boolean {
    if (depth > 6 || value === null || typeof value !== "object") return false;
    if (seen.has(value)) return false;
    seen.add(value);

    const tagged = value as {
      _tag?: unknown;
      cause?: unknown;
      error?: unknown;
    };
    if (tagged._tag === "Wallet.Transacting") {
      return true;
    }

    return (
      visit(tagged.cause, depth + 1) ||
      visit(tagged.error, depth + 1) ||
      visit((value as { message?: unknown }).message, depth + 1)
    );
  }

  return visit(error, 0);
}

async function rebalanceWithDustRetry(
  wallet: Awaited<ReturnType<typeof buildWallet>>,
  amounts: readonly bigint[],
  label: string,
  options?: { maxAttempts?: number; waitMs?: number },
): Promise<void> {
  const maxAttempts = options?.maxAttempts ?? 12;
  const waitMs = options?.waitMs ?? 3_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rebalanceUnshieldedNightCoins(wallet, amounts);
      return;
    } catch (error) {
      if (!hasWalletTransactingTag(error) || attempt === maxAttempts) {
        throw error;
      }

      console.info(
        `[integration] ${label} attempt ${attempt}/${maxAttempts} deferred: wallet transacting not ready; retrying in ${waitMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      await getWalletState(wallet, { timeoutMs: 120_000 });
    }
  }
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

    const config = buildIntegrationConfig(seedHex);
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
      await rebalanceWithDustRetry(
        wallet,
        [splitAmount, splitAmount, splitAmount],
        "split",
      );

      const afterSplit = await getWalletState(wallet, { timeoutMs: 120_000 });
      const afterSplitCount = afterSplit.unshielded.availableCoins.length;
      console.info(`[integration] after split coin count: ${afterSplitCount}`);

      // Rebuild wallet between transactions to force fresh coin selection state.
      await wallet.wallet.stop();
      wallet = await buildWallet(config);
      await getWalletState(wallet, { timeoutMs: 120_000 });

      console.info("[integration] merging coins");
      const mergeAmount = splitAmount * 3n;
      await rebalanceWithDustRetry(wallet, [mergeAmount], "merge");

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
