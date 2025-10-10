import { uuidBytes } from "@accountun/common";
import { hashAssetId } from "./asset-id";
import type {
  CurrencyEntry,
  DeployedContract,
  RawCurrencyEntry,
} from "./types";
import { AccountKind, AssetKind } from "./constants";
import { parseCurrencyEntry } from "./currency-entry";
import type { FinalizedCallTxData } from "@midnight-ntwrk/midnight-js-contracts";
import type { Contract } from "@midnight-ntwrk/midnight-js-types";

/**
 * Registers a tournament with the given contract instance
 * @param contract The deployed contract instance
 * @param tournamentId The UUID string representing the tournament ID
 * @param cashAssetName The name of the cash asset to use (default: "usd")
 * @returns The transaction data for registering the tournament
 */
export async function registerTournament(
  contract: DeployedContract,
  tournamentId: string,
  cashAssetName: string = "usd",
) {
  const tournamentIdBytes = uuidBytes(tournamentId);
  const assetIdBytes = hashAssetId(AssetKind.CASH, cashAssetName);

  const txData = await contract.callTx.registerTournament(
    tournamentIdBytes,
    assetIdBytes,
  );

  return txData;
}

/**
 * Record funding for a tournament
 * @param contract The deployed contract instance
 * @param tournamentId The UUID string representing the tournament ID
 * @param rawEntry The raw currency entry data
 * @returns The transaction data for recording the funding
 */
export async function recordFunding(
  contract: DeployedContract,
  tournamentId: string,
  entry: RawCurrencyEntry | CurrencyEntry,
) {
  const tournamentIdBytes = uuidBytes(tournamentId);

  if (isRawCurrencyEntry(entry)) {
    // If the entry is a raw currency entry, we need to parse it
    entry = parseCurrencyEntry(AccountKind.FUNDING, entry);
  }

  const txData = await contract.callTx.recordFunding(tournamentIdBytes, entry);

  return txData;
}

/**
 * Post the results of a tournament
 * @param contract The deployed contract instance
 * @param tournamentId The UUID string representing the tournament ID
 * @param playerIds An array of player UUID strings in order of placement
 * @returns The transaction data for posting the results
 */
export async function postResults(
  contract: DeployedContract,
  tournamentId: string,
  playerIds: string[] | Uint8Array[],
) {
  const tournamentIdBytes = uuidBytes(tournamentId);

  let playerIdBytes: Uint8Array[];
  if (playerIds.length > 0 && typeof playerIds[0] === "string") {
    playerIdBytes = (playerIds as string[]).map(uuidBytes);
  } else {
    playerIdBytes = playerIds as Uint8Array[];
  }

  const txData = await contract.callTx.postResults(
    tournamentIdBytes,
    playerIdBytes,
  );

  return txData;
}

/**
 * Plan the payouts for a tournament
 * @param contract The deployed contract instance
 * @param tournamentId The UUID string representing the tournament ID
 * @param payoutPlan An array of currency entries representing the payout plan in order of placement
 * @param complete whether payout plan will be complete after this call
 * @returns The transaction data for planning the payouts
 */
export async function planPayouts(
  contract: DeployedContract,
  tournamentId: string,
  payoutPlan: CurrencyEntry[] | RawCurrencyEntry[],
  complete = true,
) {
  const tournamentIdBytes = uuidBytes(tournamentId);

  const entries: CurrencyEntry[] = isRawCurrencyEntry(payoutPlan[0])
    ? (payoutPlan as RawCurrencyEntry[]).map((e) =>
        parseCurrencyEntry(AccountKind.PAYOUTS, e),
      )
    : (payoutPlan as CurrencyEntry[]);

  if (entries.length === 0) return [];

  const txs: FinalizedCallTxData<Contract, "planPayouts">[] = [];

  for (let offset = 0; offset < entries.length; offset += 8) {
    const chunk = entries.slice(offset, offset + 8);
    const isLastChunk = offset + 8 >= entries.length;
    const res = await contract.callTx.planPayouts(
      tournamentIdBytes,
      chunk,
      isLastChunk ? complete : false,
    );
    txs.push(res);
  }

  return txs;
}

/**
 * Record the receipts for a tournament
 * @param contract The deployed contract instance
 * @param tournamentId The UUID string representing the tournament ID
 * @param receipts An array of currency entries representing the receipts in order of placement
 * @returns The transaction data for recording the receipts
 */
export async function recordReceipts(
  contract: DeployedContract,
  tournamentId: string,
  receipts: CurrencyEntry[] | RawCurrencyEntry[],
) {
  const tournamentIdBytes = uuidBytes(tournamentId);

  const entries: CurrencyEntry[] = isRawCurrencyEntry(receipts[0])
    ? (receipts as RawCurrencyEntry[]).map((e) =>
        parseCurrencyEntry(AccountKind.RECEIPTS, e),
      )
    : (receipts as CurrencyEntry[]);

  if (entries.length === 0) return [];

  const txs: FinalizedCallTxData<Contract, "recordReceipts">[] = [];

  for (let offset = 0; offset < entries.length; offset += 8) {
    const chunk = entries.slice(offset, offset + 8);
    const res = await contract.callTx.recordReceipts(tournamentIdBytes, chunk);
    txs.push(res);
  }

  return txs;
}

/**
 * Complete a tournament
 * @param contract The deployed contract instance
 * @param tournamentId The UUID string representing the tournament ID
 * @returns The transaction data for completing the tournament
 */
export async function completeTournament(
  contract: DeployedContract,
  tournamentId: string,
) {
  const tournamentIdBytes = uuidBytes(tournamentId);

  const txData = await contract.callTx.payoutComplete(tournamentIdBytes);

  return txData;
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
