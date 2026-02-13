import { Command } from "commander";
import {
  allocateDust,
  getConfig,
  withWallet,
} from "@accountun/contract";
import { readDustAllocationRequests } from "../utilities/csv";
import path from "node:path";

export function registerDustCommand(program: Command) {
  program
    .command("dust")
    .description("Allocates dust to target dust addresses based on a CSV input")
    .option(
      "--csv <path>",
      "CSV file with columns: dustAddress,targetDust,allocationId(optional)",
    )
    .option(
      "--timeout-ms <ms>",
      "wallet sync/operation timeout in ms",
      "180000",
    )
    .option(
      "--tolerance-percent <percent>",
      "target matching tolerance percentage",
      "5",
    )
    .option(
      "--no-rebalance",
      "disable rebalancing when existing coin set cannot satisfy targets",
    )
    .action(
      async (options: {
        csv?: string;
        timeoutMs: string;
        tolerancePercent: string;
        rebalance: boolean;
      }) => {
        const requests = options.csv
          ? await readDustAllocationRequests(path.resolve(options.csv))
          : [];

        const timeoutMs = Number.parseInt(options.timeoutMs, 10);
        const tolerancePercent = BigInt(options.tolerancePercent);
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          throw new Error("--timeout-ms must be a positive number");
        }
        if (tolerancePercent < 0n) {
          throw new Error("--tolerance-percent must be >= 0");
        }

        const config = getConfig();
        await withWallet(config, async (wallet) => {
          if (!options.csv) {
            console.log(
              "ℹ No --csv supplied; allocating all eligible dust back to the service dust address",
            );
          } else {
            console.log("ℹ Allocating dust");
          }
          const summary = await allocateDust(wallet, requests, {
            timeoutMs,
            tolerancePercent,
            allowRebalance: options.rebalance,
          });

          console.log("✅ Allocated dust");
          console.log(" Service dust address:", summary.serviceDustAddress);
          console.log(" Requested allocations:", summary.requestedCount);
          console.log(
            " Estimated total amount:",
            summary.estimatedTotalAmount.toString(),
          );
          console.log(" Rebalance tx id:", summary.rebalanceTxId ?? "none");
          console.log(
            " Remainder registration tx id:",
            summary.remainderRegistrationTxId ?? "none",
          );
          console.log(
            " Remainder registered coins:",
            summary.remainderRegisteredCoins,
          );

          for (const allocation of summary.allocations) {
            console.log(" Allocation:");
            console.log("  Dust address:", allocation.dustAddress);
            console.log("  Target dust:", allocation.targetDust.toString());
            console.log("  Target amount:", allocation.targetAmount.toString());
            console.log("  Registration tx:", allocation.registrationTxId);
            console.log(
              "  Selected coin:",
              `${allocation.selectedCoin.txId ?? "?"}:${allocation.selectedCoin.index ?? "?"} value=${allocation.selectedCoin.value.toString()}`,
            );
          }
        });
      },
    );
}
