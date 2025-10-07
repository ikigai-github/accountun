import { is32Bytes } from "@accountun/common";
import type { PrivateState, WitnessContext, Witnesses } from "./types";

/**
 * Witness functions for the tournament accounting contract
 */
export const witnesses: Witnesses = {
  privateKey: ({
    privateState,
  }: WitnessContext): [PrivateState, Uint8Array] => {
    if (!is32Bytes(privateState.secretKey))
      throw new Error("secretKey must be 32 bytes");
    return [privateState, privateState.secretKey];
  },

  replacementKey: ({
    privateState,
  }: WitnessContext): [PrivateState, Uint8Array] => {
    if (!is32Bytes(privateState.replacementKey))
      throw new Error("replacementKey must be 32 bytes");
    return [privateState, privateState.replacementKey];
  },
};
