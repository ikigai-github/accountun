import { is16Bytes } from "@accountun/common";
import type { PrivateState, WitnessContext, Witnesses } from "./types";

/**
 * Witness functions for the tournament accounting contract
 */
export const witnesses: Witnesses = {
  privateKey: ({
    privateState,
  }: WitnessContext): [PrivateState, Uint8Array] => {
    if (!is16Bytes(privateState.secretKey))
      throw new Error("secretKey must be 16 bytes");
    return [privateState, privateState.secretKey];
  },

  replacementKey: ({
    privateState,
  }: WitnessContext): [PrivateState, Uint8Array] => {
    if (!is16Bytes(privateState.replacementKey))
      throw new Error("replacementKey must be 16 bytes");
    return [privateState, privateState.replacementKey];
  },
};
