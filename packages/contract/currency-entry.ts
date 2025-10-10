import { numberToHex, bytes32FromHex, hexToBytes } from "@accountun/common";
import type { AccountKind, CurrencyEntry, RawCurrencyEntry } from "./types";

/**
 * Convert a timestamp string to a byte array.
 * @param timestamp the timestamp string to convert
 * @returns The byte array representation of the timestamp.
 */
function timestampToBytes(timestamp: string): Uint8Array {
  const big = BigInt(timestamp);
  const hex = numberToHex(big, 8);
  return hexToBytes(hex);
}

/**
 * Parse a raw currency entry into a structured currency entry.
 * @param kind The kind of account (e.g., "funding", "payout", "receipt").
 * @param entry The raw currency entry data.
 * @returns The parsed currency entry.
 */
export function parseCurrencyEntry(
  kind: AccountKind,
  entry: RawCurrencyEntry,
): CurrencyEntry {
  return {
    kind,
    entityId: bytes32FromHex(entry.entityId),
    timestamp: timestampToBytes(entry.timestamp),
    amount: BigInt(entry.amount),
    salt: bytes32FromHex(entry.salt),
  };
}
