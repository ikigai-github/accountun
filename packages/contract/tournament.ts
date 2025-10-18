import { uuidBytes } from "@accountun/common";
import { hashAssetId } from "./asset-id";
import type {
  CurrencyEntry,
  DeployedContract,
  RawCurrencyEntry,
} from "./types";
import { AccountKind, AssetKind, MAX_PLACEMENTS } from "./constants";
import { parseCurrencyEntry } from "./conversion";

/**
 * Registers a tournament with the given contract instance
 *
 * @param contract The deployed contract instance
 * @param tournamentId The UUID string representing the tournament ID
 * @param cashAssetName The name of the cash asset to use (default: "usd")
 * @returns The transaction result from registering the tournament
 */
export async function registerTournament(
  contract: DeployedContract,
  tournamentId: string,
  cashAssetName: string = "usd",
) {
  const tournamentIdBytes = uuidBytes(tournamentId);
  const assetIdBytes = hashAssetId(AssetKind.CASH, cashAssetName);

  const txResult = await contract.callTx.registerTournament(
    tournamentIdBytes,
    assetIdBytes,
  );

  return txResult;
}

/**
 * Record funding for a tournament
 *
 * @param contract The deployed contract instance
 * @param tournamentId The UUID string representing the tournament ID
 * @param rawEntry The raw currency entry data
 * @returns The transaction result from recording the funding
 */
export async function recordFunding(
  contract: DeployedContract,
  tournamentId: string,
  rawEntry: RawCurrencyEntry | CurrencyEntry,
) {
  const tournamentIdBytes = uuidBytes(tournamentId);

  const entry = isRawCurrencyEntry(rawEntry)
    ? parseCurrencyEntry(AccountKind.FUNDING, rawEntry)
    : rawEntry;

  const txResult = await contract.callTx.recordFunding(
    tournamentIdBytes,
    entry,
  );

  return txResult;
}

/**
 * Post the results of a tournament
 *
 * @param contract The deployed contract instance
 * @param tournamentId The UUID string representing the tournament ID
 * @param playerIds An array of player UUID strings in order of placement
 * @returns The transaction result for posting the tournament results
 */
export async function postResults(
  contract: DeployedContract,
  tournamentId: string,
  playerIds: string[] | Uint8Array[],
) {
  const tournamentIdBytes = uuidBytes(tournamentId);
  const array: Uint8Array[] =
    typeof playerIds[0] === "string"
      ? (playerIds as string[]).map(uuidBytes)
      : (playerIds as Uint8Array[]);

  const ids = toFixedVectorArray(array, 16, MAX_PLACEMENTS);
  const txResult = await contract.callTx.postResults(tournamentIdBytes, ids);

  return txResult;
}

/**
 * Plan a payout for a tournament
 *
 * @param contract The deployed contract instance
 * @param tournamentId The UUID string representing the tournament ID
 * @param rawEntry The raw currency entry data
 * @returns The transaction result for planning the payouts
 */
export async function planPayout(
  contract: DeployedContract,
  tournamentId: string,
  rawEntry: CurrencyEntry | RawCurrencyEntry,
) {
  const tournamentIdBytes = uuidBytes(tournamentId);

  const entry: CurrencyEntry = isRawCurrencyEntry(rawEntry)
    ? parseCurrencyEntry(AccountKind.PAYOUTS, rawEntry)
    : rawEntry;

  const txResult = await contract.callTx.planPayout(tournamentIdBytes, entry);
  return txResult;
}

/**
 * Mark a tournament as payout ready
 * @param contract The deployed contract instance
 * @param tournamentId The UUID string representing the tournament ID
 * @returns The transaction result from marking the tournament as payout ready
 */
export async function payoutReady(
  contract: DeployedContract,
  tournamentId: string,
) {
  const tournamentIdBytes = uuidBytes(tournamentId);
  const txResult = await contract.callTx.payoutReady(tournamentIdBytes);

  return txResult;
}

/**
 * Record the receipts for a tournament
 * @param contract The deployed contract instance
 * @param tournamentId The UUID string representing the tournament ID
 * @param receipt The currency entry representing a payout receipt
 * @returns The transaction result frin recording the receipts
 */
export async function recordReceipt(
  contract: DeployedContract,
  tournamentId: string,
  rawEntry: CurrencyEntry | RawCurrencyEntry,
) {
  const tournamentIdBytes = uuidBytes(tournamentId);

  const entry: CurrencyEntry = isRawCurrencyEntry(rawEntry)
    ? parseCurrencyEntry(AccountKind.RECEIPTS, rawEntry)
    : rawEntry;

  const txResult = await contract.callTx.recordReceipt(
    tournamentIdBytes,
    entry,
  );
  return txResult;
}

/**
 * Complete a tournament
 * @param contract The deployed contract instance
 * @param tournamentId The UUID string representing the tournament ID
 * @returns The transaction result from completing the tournament
 */
export async function completeTournament(
  contract: DeployedContract,
  tournamentId: string,
) {
  const tournamentIdBytes = uuidBytes(tournamentId);
  const txResult = await contract.callTx.payoutComplete(tournamentIdBytes);

  return txResult;
}

/**
 * Cancel a tournament
 * @param contract The deployed contract instance
 * @param tournamentId The UUID string representing the tournament ID
 * @returns The transaction data for cancelling the tournament
 */
export async function cancelTournament(
  contract: DeployedContract,
  tournamentId: string,
) {
  const tournamentIdBytes = uuidBytes(tournamentId);

  const txData = await contract.callTx.cancelTournament(tournamentIdBytes);

  return txData;
}

/**
 * Type guard for RawCurrencyEntry
 * @param entry the entry to typecheck
 * @returns true if the entry is a RawCurrencyEntry, false otherwise
 */
function isRawCurrencyEntry(
  entry: RawCurrencyEntry | CurrencyEntry | undefined,
): entry is RawCurrencyEntry {
  return entry !== undefined && typeof entry.amount === "string";
}

/**
 * Pads a dynamic sized array to a fixed size by appending empty (zero) elements as needed.
 *
 * @param values The dynamic sized array that needs to be set to a fixed size
 * @param bytes The number of bytes in the empty elements in the array
 * @param length The fixed vector length
 * @returns A Uint8Array[] of the fixed length with empty elements padded as needed
 * @throws Error if the input array has more elements than the fixed length
 */
function toFixedVectorArray(
  values: Uint8Array[],
  bytes: number,
  length: number,
) {
  if (values.length > length)
    throw new Error(`Too many elements, max is ${length}`);

  if (values.length < length) {
    const pads = Array.from(
      { length: length - values.length },
      () => new Uint8Array(bytes),
    );
    values = values.concat(pads);
  }

  return values;
}
