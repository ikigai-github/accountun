import {
  intToHex,
  hexToBytes,
  bytes16FromHex,
  uuidBytes,
} from "@accountun/common";
import type { AccountKindType, CurrencyEntry, RawCurrencyEntry } from "./types";

/**
 * Convert a timestamp string to a byte array.
 * @param timestamp the timestamp string to convert
 * @returns The byte array representation of the timestamp.
 */
export function timestampToBytes(timestamp: string): Uint8Array {
  const big = BigInt(timestamp);
  const hex = intToHex(big, 8);
  return hexToBytes(hex);
}

/**
 * Convert a raw currency entry into a strongly typed currency entry.
 * @param kind The kind of account (e.g., "funding", "payout", "receipt").
 * @param entry The raw currency entry data.
 * @returns The parsed currency entry.
 */
export function parseCurrencyEntry(
  kind: AccountKindType,
  entry: RawCurrencyEntry,
): CurrencyEntry {
  return {
    kind,
    entityId: parseEntityId(entry.entityId),
    timestamp: timestampToBytes(entry.timestamp),
    amount: BigInt(entry.amount),
  };
}

/**
 * Parse an entity ID from a string.
 * @param input The input string uuid or 16-byte hex string.
 * @returns The parsed entity ID as a byte array.
 */
export function parseEntityId(input: string): Uint8Array {
  const s = input.trim();

  try {
    return uuidBytes(s);
  } catch {
    // fall through
  }

  try {
    return bytes16FromHex(s);
  } catch {
    // fall through
  }

  throw new Error(
    `Invalid entity id. Expected a UUID or a 16-byte hex string (32 hex chars). Got: "${input}"`,
  );
}
