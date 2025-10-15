import { Command } from "commander";
import { joinContract, postResults } from "@accountun/contract";
import { withClient } from "@accountun/contract/client";
import { readPlayerIds } from "../utilities/csv";
import path from "node:path";

export function registerResultsCommand(program: Command) {
  program
    .command("results")
    .description(
      "Post the results of a tournament with the accounting contract",
    )
    .requiredOption("--id <uuid>", "tournament id (UUID string")
    .requiredOption(
      "--csv <players>",
      "a CSV file containing the list of winners ids in column 0 in order of placement",
    )
    .option("--address <address>", "override the state stores contract address")
    .action(async (options: { id: string; csv: string; address?: string }) => {
      await withClient(async (client) => {
        const { id, csv, address } = options;

        const csvPath = path.resolve(csv);
        const playerIds = await readPlayerIds(csvPath);
        console.log(
          "ℹ Joining tournament contract for network:",
          client.config.network,
        );
        const deployed = await joinContract(client, { address });

        console.log("ℹ Posting results for tournament:", id);
        const tx = await postResults(deployed, id, playerIds);

        console.log("✅ Posted results for tournament:", id);
        console.log(" Tx Hash:", tx.public.txHash);
        console.log(" Tx Id: ", tx.public.txId);
      });
    });
}
