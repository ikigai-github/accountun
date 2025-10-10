import { Command } from "commander";
import {
  AccountKind,
  joinContract,
  planPayouts,
  withClient,
} from "@accountun/contract";
import { readCurrencyEntries } from "../utilities/csv";

export function registerPlanCommand(program: Command) {
  program
    .command("plan")
    .description(
      "Plan the payouts for a tournament with the accounting contract",
    )
    .requiredOption("--id <uuid>", "tournament id (UUID string")
    .requiredOption(
      "--csv <players>",
      "a CSV file containing the payout plan in order of placement",
    )
    .option(
      "--complete",
      "whether the payout plan is complete after recording this part of the plan",
      true,
    )
    .option("--address <address>", "override the state stores contract address")
    .action(
      async (options: {
        id: string;
        csv: string;
        address?: string;
        complete: boolean;
      }) => {
        await withClient(async (client) => {
          const { id, csv, address, complete } = options;

          const plan = await readCurrencyEntries(csv, AccountKind.PAYOUTS);

          console.log("ℹ Read", plan.length, "currency entries from", csv);

          console.log(
            "ℹ Joining tournament contract for network:",
            client.config.network,
          );
          const deployed = await joinContract(client, { address });

          console.log("ℹ Planning payout for tournament:", id);
          const txs = await planPayouts(deployed, id, plan, complete);

          console.log("✅ Posted results for tournament:", id);
          txs.forEach((tx, index) => {
            console.log(` Plan Tx ${index + 1}:`);
            console.log("  Tx Hash:", tx.public.txHash);
            console.log("  Tx Id: ", tx.public.txId);
          });
        });
      },
    );
}
