import { Command } from "commander";
import {
  cancelTournament,
  joinContract,
  payoutReady,
  withClient,
} from "@accountun/contract";

export function registerReadyCommand(program: Command) {
  program
    .command("ready")
    .description("Mark a tournament as payout ready")
    .requiredOption("--id <uuid>", "tournament id (UUID string)")
    .option("--address <address>", "override the state stores contract address")
    .action(async (options: { id: string; cash: string; address?: string }) => {
      await withClient(async (client) => {
        const { id, address } = options;

        console.log(
          "ℹ Joining tournament contract for network:",
          client.config.network,
        );
        const deployed = await joinContract(client, { address });

        console.log("ℹ Marking tournament as payout ready:", id);
        const tx = await payoutReady(deployed, id);

        console.log("✅ Marked tournament as payout ready:", id);
        console.log(" Tx Hash:", tx.public.txHash);
        console.log(" Tx Id: ", tx.public.txId);
      });
    });
}
