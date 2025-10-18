import { Command } from "commander";
import {
  joinContract,
  recordFunding,
  withClient,
  type RawCurrencyEntry,
} from "@accountun/contract";

export function registerFundCommand(program: Command) {
  program
    .command("fund")
    .description("Record funding for a tournament")
    .requiredOption("--id <uuid>", "tournament id (UUID string")
    .requiredOption("--amount <amount>", "amount to fund (in cash asset units)")
    .requiredOption("--entity-id <entityId>", "sponsor id (UUID string)")
    .requiredOption("--timestamp <timestamp>", "timestamp (unix epoch seconds")
    .option("--address <address>", "override the state stores contract address")
    .action(
      async (options: {
        id: string;
        amount: string;
        entityId: string;
        timestamp: string;
        address?: string;
      }) => {
        await withClient(async (client) => {
          const { id, amount, entityId, timestamp, address } = options;

          console.log(
            "ℹ Joining tournament contract for network:",
            client.config.network,
          );
          const deployed = await joinContract(client, { address });

          const currencyEntry: RawCurrencyEntry = {
            timestamp,
            entityId,
            amount,
          };

          console.log(
            "ℹ Recording funding for tournament:",
            id,
            "currency amount:",
            amount,
          );
          const tx = await recordFunding(deployed, id, currencyEntry);

          console.log("✅ Recorded funding:", id);
          console.log(" Tx Hash:", tx.public.txHash);
          console.log(" Tx Id: ", tx.public.txId);
        });
      },
    );
}
