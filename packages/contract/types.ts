import type {
  Ledger,
  Contract as ManagedContract,
} from "./managed/contract/index.js";
import type { MidnightProviders } from "@midnight-ntwrk/midnight-js-types";
import type { FoundContract } from "@midnight-ntwrk/midnight-js-contracts";
import type { Witnesses as ManagedWitnesses } from "./managed/contract/index.js";
import type { WitnessContext as CompactWitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { AccountKind, AssetKind, PrivateStateKey } from "./constants";
import type { ImpureCircuitId } from "@midnight-ntwrk/compact-js";
import type { WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import type { UnshieldedKeystore } from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import type * as ledger from "@midnight-ntwrk/ledger-v7";

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
export type Wallet = WalletFacade;

/**
 * Wallet context bundling keys and keystore required for signing.
 */
export type WalletContext = {
  readonly wallet: WalletFacade;
  readonly shieldedSecretKeys: ledger.ZswapSecretKeys;
  readonly dustSecretKey: ledger.DustSecretKey;
  readonly unshieldedKeystore: UnshieldedKeystore;
};

/**
 * The witnesses used in the accounting contract.
 */
export type Witnesses = ManagedWitnesses<PrivateState>;

/**
 * The accounting contract with type information.
 */
export type Contract = ManagedContract<PrivateState, Witnesses>;

/**
 * The keys of the circuits in the accounting contract.
 */
export type CircuitKeys = ImpureCircuitId<Contract>;

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
export type InitialStateParams = Tail<Parameters<Contract["initialState"]>>;

/**
 * The names of known midnight networks.
 */
export type NetworkName =
  | "mainnet"
  | "devnet"
  | "testnet"
  | "preview"
  | "preprod"
  | "undeployed";

/**
 * The configuration options for connecting to the Midnight Network and its services.
 */
export type MidnightConfig = {
  readonly cacheDir: string;
  readonly substrateNodeUri: string;
  readonly indexerHttpUri: string;
  readonly indexerWsUri: string;
  readonly proofServerUri: string;
  readonly serviceWalletSeedHex: string;
  readonly authSecret: Uint8Array;
  readonly authReplacementKey?: Uint8Array;
  readonly network: NetworkName;
  readonly contractAddress?: string;
};

/**
 * The client that wraps all the pieces needed to interact with midnight
 */
export type MidnightClient = {
  readonly config: MidnightConfig;
  readonly providers: Providers;
  readonly contract: Contract;
  readonly wallet: WalletContext;
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
