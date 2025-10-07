import type {
  Ledger,
  Contract as ManagedContract,
} from "./managed/contract/index.d.cts";
import type { Wallet as MidnightWallet } from "@midnight-ntwrk/wallet-api";
import type { MidnightProviders } from "@midnight-ntwrk/midnight-js-types";
import type { FoundContract } from "@midnight-ntwrk/midnight-js-contracts";
import type { Witnesses as ManagedWitnesses } from "./managed/contract/index.cjs";
import type { WitnessContext as CompactWitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { Resource as MidnightWalletResource } from "@midnight-ntwrk/wallet";

export const PrivateStateKey = "tournament-accounting-private-state";

export type PrivateStateId = typeof PrivateStateKey;

export type PrivateState = {
  readonly secretKey: Uint8Array;
  readonly replacementKey: Uint8Array;
};

export type Wallet = MidnightWallet & MidnightWalletResource;

export type Contract = ManagedContract<PrivateState>;

export type CircuitKeys = Exclude<
  keyof Contract["impureCircuits"],
  number | symbol
>;

export type Providers = MidnightProviders<
  CircuitKeys,
  PrivateStateId,
  PrivateState
>;

export type DeployedContract = FoundContract<Contract>;

export type Witnesses = ManagedWitnesses<PrivateState>;

export type WitnessContext = CompactWitnessContext<Ledger, PrivateState>;

type Tail<T extends any[]> = T extends [any, ...infer Rest] ? Rest : never;

export type InitialStateParams = Tail<
  Parameters<ManagedContract<PrivateState>["initialState"]>
>;

export type NetworkName = "mainnet" | "testnet" | "devnet" | "undeployed";

export type MidnightConfig = {
  readonly stateDir: string;
  readonly substrateNodeUri: string;
  readonly indexerHttpUri: string;
  readonly indexerWsUri: string;
  readonly proofServerUri: string;
  readonly serviceWalletSeedHex: string;
  readonly authSecret: Uint8Array;
  readonly authReplacementKey?: Uint8Array;
  readonly network: NetworkName;
};
