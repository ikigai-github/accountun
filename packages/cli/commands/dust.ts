import { Command } from "commander";
import { reconcileDustAllocations, getConfig } from "@accountun/contract";
import { readDustAllocationRequests } from "../utilities/csv";
import path from "node:path";

export function registerDustCommand(program: Command) {
  program
    .command("dust")
    .description("Reconciles dust allocations in Specks to target addresses")
    .option(
      "--csv <path>",
      "CSV file with columns: allocationId,dustAddress,targetSpecks,priority(optional)",
    )
    .option(
      "--timeout-ms <ms>",
      "wallet sync/operation timeout in ms",
      "180000",
    )
    .option(
      "--main-reserve-percent <percent>",
      "percentage of total NIGHT that must remain in main wallet",
      "50",
    )
    .option("--request-id <id>", "idempotency key for reconciliation request")
    .option("--execute", "execute on-chain actions (currently unavailable)")
    .action(
      async (options: {
        csv?: string;
        timeoutMs: string;
        mainReservePercent: string;
        requestId?: string;
        execute?: boolean;
      }) => {
        const requests = options.csv
          ? await readDustAllocationRequests(path.resolve(options.csv))
          : [];

        const timeoutMs = Number.parseInt(options.timeoutMs, 10);
        const mainReservePercent = BigInt(options.mainReservePercent);
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          throw new Error("--timeout-ms must be a positive number");
        }
        if (mainReservePercent < 0n || mainReservePercent > 100n) {
          throw new Error("--main-reserve-percent must be between 0 and 100");
        }

        const config = getConfig();

        console.log("ℹ Reconciling dust allocations");
        const summary = await reconcileDustAllocations(config, requests, {
          requestId: options.requestId,
          timeoutMs,
          mainReservePercent,
          dryRun: !options.execute,
        });

        console.log(
          summary.dryRun
            ? "✅ Reconcile plan created"
            : "✅ Reconcile executed",
        );
        console.log(" Request id:", summary.requestId);
        console.log(" Service dust address:", summary.serviceDustAddress);
        console.log(" Reserve %:", summary.reservePercent.toString());
        console.log(" Main min NIGHT:", summary.mainMinNight.toString());
        console.log(" Main current NIGHT:", summary.mainActualNight.toString());
        console.log(" Requested Specks:", summary.requestedSpecks.toString());
        console.log(" Allocated Specks:", summary.allocatedSpecks.toString());
        console.log(" Shortfall Specks:", summary.shortfallSpecks.toString());

        for (const action of summary.actions) {
          console.log(" Action:");
          console.log("  Allocation:", action.allocationId);
          console.log("  Wallet index:", action.walletIndex);
          console.log("  Op:", action.op);
          if (action.amountNight !== undefined) {
            console.log("  Amount NIGHT:", action.amountNight.toString());
          }
          if (action.reason) {
            console.log("  Reason:", action.reason);
          }
        }

        for (const entry of summary.deallocated) {
          console.log(" Deallocated:");
          console.log("  Wallet index:", entry.walletIndex);
          console.log("  Swept NIGHT:", entry.sweptNight.toString());
        }
      },
    );
}
