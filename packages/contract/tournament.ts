import { assetId, AssetKind, uuidBytes } from "./asset-id";
import type { DeployedContract } from "./types";

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
  const assetIdBytes = assetId(AssetKind.CASH, cashAssetName);

  const txData = await contract.callTx.registerTournament(
    tournamentIdBytes,
    assetIdBytes,
  );

  return txData;
}
