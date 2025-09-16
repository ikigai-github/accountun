import { u128ArrayFrom, u64ArrayFrom } from "./array";
import { blake2b } from "@noble/hashes/blake2";

const encoder = new TextEncoder();

export type EntityIdArray = Uint8Array;
export type Hash256Array = Uint8Array;

export const Domain = {
  FUNDING: 0x01,
  RECEIPT: 0x02,
  ENTITLEMENT: 0x03,
} as const;

export type DomainType = (typeof Domain)[keyof typeof Domain];

export const AssetKind = {
  NONE: 0x00,
  CASH: 0x01,
  ITEM: 0x02,
} as const;

export type AssetKindType = (typeof AssetKind)[keyof typeof AssetKind];

export function blake2b256(message: Uint8Array): Hash256Array {
  return blake2b(message, { dkLen: 32 });
}

export function assetId(kind: AssetKindType, descriptor: string): Hash256Array {
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

export function encodeLeaf(
  domain: DomainType,
  timestamp: bigint,
  entity: EntityIdArray,
  assetId: Hash256Array,
  amount: bigint,
): Uint8Array {
  if (entity.length !== 16) throw new Error("entity must be 16 bytes");
  if (assetId.length !== 32) throw new Error("assetId must be 32 bytes");

  const array = new Uint8Array(1 + 8 + 16 + 32 + 16);
  let i = 0;
  array[i++] = domain;

  array.set(u64ArrayFrom(timestamp), i);
  i += 8;

  array.set(entity, i);
  i += 16;

  array.set(assetId, i);
  i += 32;

  array.set(u128ArrayFrom(amount), i);

  return array;
}

export function emptyLeafBytes(domain: DomainType): Uint8Array {
  const array = new Uint8Array(1 + 8 + 16 + 32 + 16);
  let i = 0;

  // domain (1 byte)
  array[i++] = domain;

  // timestamp (8 bytes)
  array.fill(0xff, i, i + 8);
  i += 8;

  // entity (16 bytes), assetId (32 bytes), amount (16 bytes)
  array.fill(0x00, i, i + 64);
  i += 64;

  return array;
}

export function hashLeaf(bytes: Uint8Array): Hash256Array {
  return blake2b256(bytes);
}
