import { Command } from "commander";
import {
  joinContract,
  loadAddress,
  registerTournament,
} from "@accountun/contract";
import { withClient } from "../client";

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
        const { config, contract, providers } = client;
        const { id, cash, address } = options;
        // Get the contract address from the config file
        console.log("ℹ Loading contract address for network:", config.network);
        const contractAddress =
          address ?? (await loadAddress(config.stateDir, config.network));

        console.log("ℹ Joining contract at address:", contractAddress);
        const deployed = await joinContract(
          contractAddress,
          contract,
          providers,
        );

        console.log("ℹ Registering tournament:", id, "with cash asset:", cash);
        const txData = await registerTournament(deployed, id, cash);

        console.log("✅ Registered tournament:", id);
        console.log(" Tx Hash:", txData.public.txHash);
        console.log(" Tx Id: ", txData.public.txId);
      });
    });
}
