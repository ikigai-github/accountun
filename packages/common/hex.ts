import { is16Bytes, is32Bytes } from "./array";

/**
 * Checks if a string is a valid hexadecimal representation
 * @param value the string to check
 * @returns true if the string is a valid hex string, false otherwise
 */
export function isHex(value: string) {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  return hex.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(hex);
}

/**
 * Checks if a string is a valid 32-byte hexadecimal representation
 * @param value the string to check
 * @returns true if the string is a valid 32-byte hex string, false otherwise
 */
export function isHex32(value: string) {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  return hex.length % 2 === 0 && /^[0-9a-fA-F]{64}$/.test(hex);
}

/**
 * Utility function to convert a hex string to a byte array
 * @param value the hex string to convert
 * @returns The byte array representation of the hex string
 */
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

/**
 * Utility function to convert a hex string to a 16-byte array.  Will throw if not 16 bytes.
 * @param hex the hex string to convert
 * @returns The 16-byte array representation of the hex string
 */
export function bytes16FromHex(hex: string) {
  const bytes = hexToBytes(hex);
  if (!is16Bytes(bytes)) throw new Error("expected 16 bytes");

  return bytes;
}

/**
 * Utility function to convert a hex string to a 32-byte array.  Will throw if not 32 bytes.
 * @param hex The hex string to convert
 * @returns The 32-byte array representation of the hex string
 */
export function bytes32FromHex(hex: string) {
  const bytes = hexToBytes(hex);
  if (!is32Bytes(bytes)) throw new Error("expected 32 bytes");

  return bytes;
}

/**
 * Converts a byte array to a hex string
 * @param value the byte array to convert
 * @returns The hex string representation of the byte array
 */
export function bytesToHex(value: Uint8Array): string {
  return Buffer.from(value).toString("hex");
}

/**
 * Check two byte arrays for equality
 * @param a left byte array
 * @param b right byte array
 * @returns true if the byte arrays are equal byte for byte and length, false otherwise
 */
export function equalBytes(a: Uint8Array, b: Uint8Array) {
  return a.byteLength === b.byteLength && a.every((v, i) => v === b[i]);
}
