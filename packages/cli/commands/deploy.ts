import { Command } from "commander";
import { deployContract as deploy, saveAddress } from "@accountun/contract";
import { withClient } from "../client";

export function registerDeployCommand(program: Command) {
  program
    .command("deploy")
    .description(
      "Deploy the tournament-accounting contract and print the contract address",
    )
    .action(async () => {
      await withClient(async (client) => {
        const { config, privateState, contract, providers } = client;

        const result = await deploy(
          privateState.secretKey,
          contract,
          providers,
          privateState,
        );

        const address = result.deployTxData.public.contractAddress;

        // Save the address to be used with other commands
        await saveAddress(config.stateDir, config.network, address);

        console.log("✅ Deployed contract address:", address);
      });
    });
}
