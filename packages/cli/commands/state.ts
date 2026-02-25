import { Command } from "commander";
import {
  joinContract,
  readTournamentOnChainState,
  withClient,
} from "@accountun/contract";

const STATES_WITH_RESULTS = new Set([
  "ResultPosted",
  "PayoutReady",
  "PayoutComplete",
]);

export function registerStateCommand(program: Command) {
  program
    .command("state")
    .description(
      "Read a tournament state from chain and print placements when results exist",
    )
    .requiredOption("--id <uuid>", "tournament id (UUID string)")
    .option("--address <address>", "override the stored contract address")
    .action(async (options: { id: string; address?: string }) => {
      await withClient(async (client) => {
        const { id, address } = options;

        console.log(
          "ℹ Joining tournament contract for network:",
          client.config.network,
        );
        const deployed = await joinContract(client, { address });

        console.log("ℹ Reading tournament state from chain:", id);
        const snapshot = await readTournamentOnChainState(
          deployed,
          client.providers,
          id,
        );

        console.log("✅ Tournament state loaded");
        console.log(" Contract:", snapshot.contractAddress);
        console.log(" Tournament:", snapshot.tournamentId);
        console.log(" State:", `${snapshot.state} (${snapshot.stateName})`);

        if (!STATES_WITH_RESULTS.has(snapshot.stateName)) {
          console.log(" Placements: not available before results are posted");
          return;
        }

        if (snapshot.placements.length === 0) {
          console.log(" Placements: (none)");
          return;
        }

        console.log(" Placements:");
        for (const [index, playerId] of snapshot.placements.entries()) {
          console.log(`  ${index + 1}. ${playerId}`);
        }
      });
    });
}
