import { Command } from "commander";
import {
  joinContract,
  registerTournament,
  withClient,
} from "@accountun/contract";

export function registerRegisterCommand(program: Command) {
  program
    .command("register")
    .description("Register a tournament with the accounting contract")
    .requiredOption("--id <uuid>", "tournament id (UUID string")
    .option(
      "--cash <name>",
      "cash currency code, crypto ticker symbol, or token name",
      "usd",
    )
    .option("--address <address>", "override the state stores contract address")
    .action(async (options: { id: string; cash: string; address?: string }) => {
      await withClient(async (client) => {
        const { id, cash, address } = options;

        console.log(
          "ℹ Joining tournament contract for network:",
          client.config.network,
        );
        const deployed = await joinContract(client, { address });

        console.log("ℹ Registering tournament:", id, "with cash asset:", cash);
        const tx = await registerTournament(deployed, id, cash);

        console.log("✅ Registered tournament:", id);
        console.log(" Tx Hash:", tx.public.txHash);
        console.log(" Tx Id: ", tx.public.txId);
      });
    });
}
