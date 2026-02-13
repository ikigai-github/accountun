import { describe, expect, it } from "bun:test";
import {
  isDustEligibleUnshieldedNightCoin,
  isDustRegistered,
  type UnshieldedCoinLike,
} from "../utilities/dust";
import { unshieldedToken } from "@midnight-ntwrk/ledger-v7";

describe("dust utilities", () => {
  const nightToken = unshieldedToken().raw;

  const baseCoin = (
    overrides: Partial<UnshieldedCoinLike> = {},
  ): UnshieldedCoinLike => ({
    utxo: { type: nightToken, txId: "tx", index: 0 },
    ...overrides,
  });

  it("detects registered dust coins", () => {
    expect(
      isDustRegistered(
        baseCoin({ meta: { registeredForDustGeneration: true } }),
      ),
    ).toBe(true);
    expect(
      isDustRegistered(
        baseCoin({ meta: { registeredForDustGeneration: false } }),
      ),
    ).toBe(false);
    expect(isDustRegistered(baseCoin())).toBe(false);
  });

  it("detects eligible unshielded NIGHT coins", () => {
    expect(isDustEligibleUnshieldedNightCoin(baseCoin())).toBe(true);
    expect(
      isDustEligibleUnshieldedNightCoin(
        baseCoin({ meta: { registeredForDustGeneration: true } }),
      ),
    ).toBe(false);
    expect(
      isDustEligibleUnshieldedNightCoin(
        baseCoin({ utxo: { type: "not-night", txId: "tx", index: 0 } }),
      ),
    ).toBe(false);
  });
});
