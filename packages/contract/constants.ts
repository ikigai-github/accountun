/**
 * The private state key for now is fixed will see if this needs to change
 */
export const PrivateStateKey = "tournament-accounting-private-state";

/**
 * The kinds of assets that can be accounted for are cash or items.
 * Invalid is used for uninitialized values.
 */
export const AssetKind = {
  INVALID: 0,
  CASH: 1,
  ITEM: 2,
} as const;

/**
 * The kinds of accounts used in currency entries for funding, payouts, and receipts.
 * Invalid is used for uninitialized values.
 */
export const AccountKind = {
  INVALID: 0,
  FUNDING: 1,
  PAYOUTS: 2,
  RECEIPTS: 3,
} as const;

/**
 * The maximum number of placements supported in the compiled tournament contract
 * TODO: Tie this more directly to the contract.
 */
export const MAX_PLACEMENTS = 16;

/**
 * The maximum number of currency entries that can be processed in a single transaction.
 */
export const MAX_CURRENCY_ENTRIES = 8;
