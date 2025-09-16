import {
  type MerkleTreeDigest,
  type WitnessContext,
} from "@midnight-ntwrk/compact-runtime";
import { type Ledger } from "./managed/contract/index.cjs";

import { equalBytes, is32Bytes } from "@accountun/common";

type LeafBytes = Uint8Array;

export type PayoutCompletePublicInputs = {
  fundingRoot: MerkleTreeDigest;
  receiptsRoot: MerkleTreeDigest;
  hashedSum: Uint8Array;
};

export type PayoutCompletePrivateInputs = {
  salt: Uint8Array;
  sum: bigint;
  fundingLeaves: bigint[];
  receiptsLeaves: bigint[];
};

export type PayoutComplete = {
  public: PayoutCompletePublicInputs;
  private: PayoutCompletePrivateInputs;
};

export type PayoutCompleteWitnessArgs = PayoutComplete & {
  witnessName: "provePayoutComplete";
};

export type PrivateState = {
  readonly secretKey: Uint8Array;
  readonly payout?: PayoutComplete;
  readonly prover: {
    proveComplete: (args: PayoutCompleteWitnessArgs) => Promise<void>;
  };
};

function eqDigest(a: MerkleTreeDigest, b: MerkleTreeDigest) {
  return a.field === b.field;
}

export const witnesses = {
  privateKey: ({
    privateState,
  }: WitnessContext<Ledger, PrivateState>): [PrivateState, Uint8Array] => {
    if (!is32Bytes(privateState.secretKey))
      throw new Error("secretKey must be 32 bytes");
    return [privateState, privateState.secretKey];
  },

  provePayoutComplete: (
    { privateState }: WitnessContext<Ledger, PrivateState>,
    fundingRoot: MerkleTreeDigest,
    receiptsRoot: MerkleTreeDigest,
    hashedSum: Uint8Array,
  ): [PrivateState, boolean] => {
    if (!is32Bytes(hashedSum)) throw new Error("hashedSum must be 32 bytes");

    const ctx = privateState.payout;
    if (!ctx) throw new Error("No payout bundle configured in PrivateState");

    // Sanity: ensure the public inputs the circuit provided match the preloaded context.
    const pub = ctx.public;
    if (
      !eqDigest(pub.fundingRoot, fundingRoot) ||
      !eqDigest(pub.receiptsRoot, receiptsRoot) ||
      !equalBytes(pub.hashedSum, hashedSum)
    ) {
      throw new Error("Public inputs do not match configured payout bundle");
    }

    const priv = ctx.private;

    if (!is32Bytes(priv.salt)) throw new Error("Salt must be 32 bytes");

    if (
      !Array.isArray(priv.fundingLeaves) ||
      !Array.isArray(priv.receiptsLeaves)
    ) {
      throw new Error("Must include fundingLeaves and receiptsLeaves arrays");
    }

    void privateState.prover.proveComplete({
      witnessName: "provePayoutComplete",
      public: pub,
      private: priv,
    });

    return [privateState, true];
  },
};
