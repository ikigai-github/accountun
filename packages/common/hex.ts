import { is16Bytes, is32Bytes } from "./array";

export function isHex(value: string) {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  return hex.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(hex);
}

export function isHex32(value: string) {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  return hex.length % 2 === 0 && /^[0-9a-fA-F]{64}$/.test(hex);
}

export function hexToBytes(value: string): Uint8Array {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (hex.length % 2) throw new Error("hex length must be even");

  if (!isHex(hex))
    throw new Error("hex string must only contain 0-9, a-f, A-F");

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);

  return bytes;
}

export function bytes16FromHex(hex: string) {
  const bytes = hexToBytes(hex);
  if (!is16Bytes(bytes)) throw new Error("expected 16 bytes");

  return bytes;
}

export function bytes32FromHex(hex: string) {
  const bytes = hexToBytes(hex);
  if (!is32Bytes(bytes)) throw new Error("expected 32 bytes");

  return bytes;
}

export function bytesToHex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

export function equalBytes(a: Uint8Array, b: Uint8Array) {
  return a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);
}
