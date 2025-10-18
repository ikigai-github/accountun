import { blake2b } from "@noble/hashes/blake2.js";
import { parse as uuidParse } from "uuid";

/**
 * Wrapper function to compute the Blake2b 32 bit hash of a message
 * @param message the message to hash
 * @returns the 32-byte hash of the message as a byte array
 */
export function blake2b32(message: Uint8Array): Uint8Array {
  return blake2b(message, { dkLen: 32 });
}

/**
 * Wrapper function to compute the Blake2b 32 bit hash of a message
 * @param message the message to hash
 * @returns the 32-byte hash of the message as a byte array
 */
export function blake2b16(message: Uint8Array): Uint8Array {
  return blake2b(message, { dkLen: 16 });
}

/**
 * Utility function to convert a UUID string to a 16-byte Uint8Array
 * @param uuid the UUID string to convert to bytes
 * @returns the parsed UUID as a 16-byte Uint8Array
 */
export function uuidBytes(uuid: string): Uint8Array {
  return uuidParse(uuid);
}
