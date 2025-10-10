import { Command } from "commander";
import {
  AccountKind,
  joinContract,
  recordReceipts,
  withClient,
} from "@accountun/contract";
import { readCurrencyEntries } from "../utilities/csv";

export function registerReceiptsCommand(program: Command) {
  program
    .command("receipts")
    .description(
      "Record the receipts for a tournament with the accounting contract",
    )
    .requiredOption("--id <uuid>", "tournament id (UUID string")
    .requiredOption(
      "--csv <players>",
      "a CSV file containing the receipt entries in order of placement",
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
          const { id, csv, address } = options;

          const receipts = await readCurrencyEntries(csv, AccountKind.RECEIPTS);

          console.log("ℹ Read", receipts.length, "currency entries from", csv);

          console.log(
            "ℹ Joining tournament contract for network:",
            client.config.network,
          );
          const deployed = await joinContract(client, { address });

          console.log("ℹ Recording receipts for tournament:", id);
          const txs = await recordReceipts(deployed, id, receipts);

          console.log("✅ Posted receipts for tournament:", id);
          txs.forEach((tx, index) => {
            console.log(` Receipt Tx ${index + 1}:`);
            console.log("  Tx Hash:", tx.public.txHash);
            console.log("  Tx Id: ", tx.public.txId);
          });
        });
      },
    );
}
