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
import type { AccountKind, AssetKind, PrivateStateKey } from "./constants";

/**
 * The type of the id of the private state stored on-chain for the accounting contract.
 */
export type PrivateStateId = typeof PrivateStateKey;

/**
 * The private state stored on-chain for the accounting contract.
 */
export type PrivateState = {
  readonly secretKey: Uint8Array;
  readonly replacementKey: Uint8Array;
};

/**
 * The wallet used to sign transactions and interact with the Midnight Network.
 */
export type Wallet = MidnightWallet & MidnightWalletResource;

/**
 * The accounting contract with type information.
 */
export type Contract = ManagedContract<PrivateState>;

/**
 * The keys of the circuits in the accounting contract.
 */
export type CircuitKeys = Exclude<
  keyof Contract["impureCircuits"],
  number | symbol
>;

/**
 * The providers used to connect to the Midnight Network and its services.
 */
export type Providers = MidnightProviders<
  CircuitKeys,
  PrivateStateId,
  PrivateState
>;

/**
 * A deployed contract instance with type information.
 */
export type DeployedContract = FoundContract<Contract>;

/**
 * The witnesses used in the accounting contract.
 */
export type Witnesses = ManagedWitnesses<PrivateState>;

/**
 * The context provided to witness functions in the accounting contract.
 */
export type WitnessContext = CompactWitnessContext<Ledger, PrivateState>;

/**
 * Utility type to get the tail of a tuple type T
 */
type Tail<T extends any[]> = T extends [any, ...infer Rest] ? Rest : never;

/**
 * Utility type to extract the parameter types of the initialState method of the ManagedContract,
 */
export type InitialStateParams = Tail<
  Parameters<ManagedContract<PrivateState>["initialState"]>
>;

/**
 * The names of known midnight networks.
 */
export type NetworkName = "mainnet" | "testnet" | "devnet" | "undeployed";

/**
 * The configuration options for connecting to the Midnight Network and its services.
 */
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

/**
 * The client that wraps all the pieces needed to interact with midnight
 */
export type MidnightClient = {
  readonly config: MidnightConfig;
  readonly providers: Providers;
  readonly contract: Contract;
  readonly wallet: Wallet;
  readonly privateState: PrivateState;
};

/**
 * The kinds of accounts used in currency entries for funding, payouts, and receipts.
 */
export type AccountKindType = (typeof AccountKind)[keyof typeof AccountKind];

/**
 * The kinds of assets that can be accounted for are cash or items.
 */
export type AssetKindType = (typeof AssetKind)[keyof typeof AssetKind];

/**
 * A unparsed currency entry passed from the CLI or API.
 * Can probably do better typing for API but this is fine for now.
 */
export type RawCurrencyEntry = {
  timestamp: string; // stringified u64
  entityId: string; // hex string of Bytes<16>
  amount: string; // stringified u64
};

/**
 * A currency entry used for funding, payouts, and receipts in the accounting contract.
 */
export type CurrencyEntry = {
  kind: AccountKindType;
  timestamp: Uint8Array; // Bytes<8>
  entityId: Uint8Array; // Bytes<16>
  amount: bigint; // u64
};
