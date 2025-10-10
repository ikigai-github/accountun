import { Command } from "commander";
import {
  cancelTournament,
  joinContract,
  withClient,
} from "@accountun/contract";

export function registerCancelCommand(program: Command) {
  program
    .command("cancel")
    .description("Cancel a registered tournament in the ledger")
    .requiredOption("--id <uuid>", "tournament id (UUID string")
    .option("--address <address>", "override the state stores contract address")
    .action(async (options: { id: string; cash: string; address?: string }) => {
      await withClient(async (client) => {
        const { id, address } = options;

        console.log(
          "ℹ Joining tournament contract for network:",
          client.config.network,
        );
        const deployed = await joinContract(client, { address });

        console.log("ℹ Cancelling tournament:", id);
        const tx = await cancelTournament(deployed, id);

        console.log("✅ Cancelled tournament:", id);
        console.log(" Tx Hash:", tx.public.txHash);
        console.log(" Tx Id: ", tx.public.txId);
      });
    });
}
