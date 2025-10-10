import { blake2b32 } from "@accountun/common";
import type { AssetKind } from "./types";

const encoder = new TextEncoder();

/**
 * Normalizes the descriptor and computes the asset ID by hashing the kind byte
 * concatenated with the normalized descriptor using Blake2b-256.
 * @param kind The kind of asset (AssetKind.CASH or AssetKind.ITEM)
 * @param descriptor the descriptor of the asset (e.g. "USD", "Sword of Truth")
 * @returns The byte array representing the computed asset id (32 byte hash)
 */
export function hashAssetId(kind: AssetKind, descriptor: string): Uint8Array {
  const canonical = descriptor
    .normalize()
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
  const body = encoder.encode(canonical);
  const array = new Uint8Array(1 + body.length);

  array[0] = kind;
  array.set(body, 1);

  return blake2b32(array);
}
