import { describe, expect, it } from "bun:test";
import {
  isDustEligibleNightUtxo,
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

  it("detects registered dust UTXOs", () => {
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

  it("detects eligible NIGHT UTXOs", () => {
    expect(isDustEligibleNightUtxo(baseCoin())).toBe(true);
    expect(
      isDustEligibleNightUtxo(
        baseCoin({ meta: { registeredForDustGeneration: true } }),
      ),
    ).toBe(false);
    expect(
      isDustEligibleNightUtxo(
        baseCoin({ utxo: { type: "not-night", txId: "tx", index: 0 } }),
      ),
    ).toBe(false);
  });
});
