import { describe, expect, it } from "bun:test";
import { Observable } from "rxjs";
import { unshieldedToken } from "@midnight-ntwrk/ledger-v7";
import {
  deregisterDustForCoins,
  estimateCoinAmountForDustTarget,
  registerAvailableDustCoins,
  selectDustCoinsForAmount,
} from "../wallet";

type TestCoin = {
  utxo: {
    type: string;
    value: bigint;
    txId: string;
    index: number;
    ctime?: Date;
  };
  meta?: {
    ctime?: Date;
    registeredForDustGeneration?: boolean;
  };
};

const nightToken = unshieldedToken().raw;

const coin = (
  value: bigint,
  txId: string,
  index: number,
  overrides?: Partial<TestCoin>,
): TestCoin => ({
  utxo: {
    type: nightToken,
    value,
    txId,
    index,
    ctime: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides?.utxo,
  },
  meta: {
    ctime: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides?.meta,
  },
});

function mockWalletContext(
  stateFactory: () => any,
  walletOverrides: Record<string, unknown> = {},
): any {
  const walletApi = {
    state: () =>
      new Observable((subscriber) => {
        const state = stateFactory();
        setTimeout(() => subscriber.next(state), 0);
        setTimeout(() => subscriber.next(state), 2);
        setTimeout(() => subscriber.complete(), 4);
      }),
    registerNightUtxosForDustGeneration: async () => ({ id: "recipe" }),
    deregisterFromDustGeneration: async () => ({ id: "recipe" }),
    finalizeRecipe: async (recipe: unknown) => recipe,
    submitTransaction: async () => "tx-123",
    ...walletOverrides,
  };

  return {
    wallet: walletApi,
    shieldedSecretKeys: {} as any,
    dustSecretKey: {} as any,
    unshieldedKeystore: {
      getPublicKey: () => ({}) as any,
      signData: () => new Uint8Array([1]),
      getBech32Address: () => ({ toString: () => "invalid-not-used" }),
    },
  };
}

describe("wallet unit", () => {
  it("registerAvailableDustCoins returns null when no eligible NIGHT coins", async () => {
    const wallet = mockWalletContext(() => ({
      isSynced: true,
      shielded: { balances: {} },
      unshielded: {
        balances: {},
        availableCoins: [
          coin(50n, "a", 0, {
            utxo: { type: "not-night", value: 50n, txId: "a", index: 0 },
          }),
        ],
      },
      dust: { dustAddress: "dust-unused", estimateDustGeneration: () => [] },
    }));

    const result = await registerAvailableDustCoins(wallet);
    expect(result).toBeNull();
  });

  it("registerAvailableDustCoins registers only eligible NIGHT coins", async () => {
    let passedCoins: TestCoin[] = [];
    const wallet = mockWalletContext(
      () => ({
        isSynced: true,
        shielded: { balances: {} },
        unshielded: {
          balances: {},
          availableCoins: [
            coin(100n, "n1", 0),
            coin(80n, "n2", 1, {
              meta: { registeredForDustGeneration: true },
            }),
            coin(40n, "x", 2, {
              utxo: { type: "not-night", value: 40n, txId: "x", index: 2 },
            }),
          ],
        },
        dust: { dustAddress: "dust-unused", estimateDustGeneration: () => [] },
      }),
      {
        registerNightUtxosForDustGeneration: async (coins: TestCoin[]) => {
          passedCoins = coins;
          return { id: "recipe" };
        },
      },
    );

    const result = await registerAvailableDustCoins(wallet);

    expect(result).toEqual({ txId: "tx-123", registeredCoins: 1 });
    expect(passedCoins.length).toBe(1);
    expect(passedCoins[0]?.utxo.txId).toBe("n1");
  });

  it("estimateCoinAmountForDustTarget returns required NIGHT from network params", async () => {
    const result = await estimateCoinAmountForDustTarget(100n, {
      targetWindowMs: 60 * 60 * 1000,
      params: {
        nightDustRatio: 10n,
        timeToCapSeconds: 10n,
        generationDecayRate: 0n,
        dustGracePeriodSeconds: 0n,
      },
    });

    expect(result).toBe(1n);
  });

  it("selectDustCoinsForAmount picks closest eligible coin", async () => {
    const wallet = mockWalletContext(() => ({
      isSynced: true,
      shielded: { balances: {} },
      unshielded: {
        balances: {},
        availableCoins: [
          coin(98n, "a", 0),
          coin(103n, "b", 1),
          coin(200n, "c", 2),
        ],
      },
      dust: { dustAddress: "dust-unused", estimateDustGeneration: () => [] },
    }));

    const selected = await selectDustCoinsForAmount(wallet, 100n);

    expect(selected.length).toBe(1);
    expect((selected[0]?.utxo as { txId?: string })?.txId).toBe("a");
  });

  it("selectDustCoinsForAmount returns empty when no match and rebalance disabled", async () => {
    const wallet = mockWalletContext(() => ({
      isSynced: true,
      shielded: { balances: {} },
      unshielded: {
        balances: {},
        availableCoins: [coin(10n, "a", 0), coin(20n, "b", 1)],
      },
      dust: { dustAddress: "dust-unused", estimateDustGeneration: () => [] },
    }));

    const selected = await selectDustCoinsForAmount(wallet, 100n, {
      allowRebalance: false,
    });

    expect(selected).toEqual([]);
  });

  it("deregisterDustForCoins submits tx for matched references", async () => {
    let deregisteredCoins: TestCoin[] = [];
    const wallet = mockWalletContext(
      () => ({
        isSynced: true,
        shielded: { balances: {} },
        unshielded: {
          balances: {},
          availableCoins: [coin(30n, "match", 4), coin(40n, "other", 2)],
        },
        dust: { dustAddress: "dust-unused", estimateDustGeneration: () => [] },
      }),
      {
        deregisterFromDustGeneration: async (coins: TestCoin[]) => {
          deregisteredCoins = coins;
          return { id: "recipe" };
        },
      },
    );

    const txId = await deregisterDustForCoins(wallet, [
      { txId: "match", index: 4 },
    ]);

    expect(txId).toBe("tx-123");
    expect(deregisteredCoins.length).toBe(1);
    expect(deregisteredCoins[0]?.utxo.txId).toBe("match");
  });
});
