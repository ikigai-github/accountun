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
 * Converts an integer value to a bigint
 * @param value the value to convert
 * @returns the converted bigint
 */
export function intToBigint(value: bigint | number | string) {
  let converted: bigint;
  if (typeof value === "bigint") {
    converted = value;
  } else if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new RangeError("number must be a finite integer");
    }
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(
        "number exceeds MAX_SAFE_INTEGER; use bigint or string",
      );
    }
    converted = BigInt(value);
  } else {
    if (!/^\d+$/.test(value)) {
      throw new RangeError("string must be a decimal unsigned integer");
    }
    converted = BigInt(value);
  }

  return converted;
}

/**
 * Converts a bigint to a hex string
 * @param a the bigint to convert
 * @param byteLength the desired byte length of the output hex string
 * @returns The hex string representation of the bigint
 */
export function intToHex(
  value: bigint | number | string,
  byteLength?: number,
): string {
  const int = intToBigint(value);

  if (int < 0n) throw new RangeError("value must be non-negative");

  let hex = int.toString(16);

  if (hex.length % 2) hex = "0" + hex;

  if (byteLength !== undefined) {
    const target = byteLength * 2; // hex chars
    if (hex.length > target) {
      throw new RangeError(`value does not fit in ${byteLength} bytes`);
    } else if (hex.length < target) {
      hex = hex.padStart(target, "0");
    }
  }

  return hex;
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
