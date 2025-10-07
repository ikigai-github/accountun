import { blake2b } from "@noble/hashes/blake2.js";
import { parse as uuidParse } from "uuid";

const encoder = new TextEncoder();

/**
 * Enum representing different kinds of assets that can be accounted for.
 */
export const AssetKind = {
  NONE: 0x00,
  CASH: 0x01,
  ITEM: 0x02,
} as const;

export type AssetKindType = (typeof AssetKind)[keyof typeof AssetKind];

/**
 * Utility function to compute the Blake2b-256 hash of a message
 * @param message the message to hash
 * @returns the 32-byte hash of the message as a byte array
 */
export function blake2b256(message: Uint8Array): Uint8Array {
  return blake2b(message, { dkLen: 32 });
}

/**
 * Utility function to convert a UUID string to a 16-byte Uint8Array
 * @param uuid the UUID string to convert to bytes
 * @returns the parsed UUID as a 16-byte Uint8Array
 */
export function uuidBytes(uuid: string): Uint8Array {
  return uuidParse(uuid);
}

/**
 * Normalizes the descriptor and computes the asset ID by hashing the kind byte
 * concatenated with the normalized descriptor using Blake2b-256.
 * @param kind The kind of asset (AssetKind.CASH or AssetKind.ITEM)
 * @param descriptor the descriptor of the asset (e.g. "USD", "Sword of Truth")
 * @returns The byte array representing the computed asset id (32 byte hash)
 */
export function assetId(kind: AssetKindType, descriptor: string): Uint8Array {
  const canonical = descriptor
    .normalize()
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  const body = encoder.encode(canonical);
  const array = new Uint8Array(1 + body.length);

  array[0] = kind;
  array.set(body, 1);

  return blake2b256(array);
}
