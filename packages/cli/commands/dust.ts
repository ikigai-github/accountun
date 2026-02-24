import { Command } from "commander";
import {
  reconcileDustAllocation,
  planDustAllocations,
  getConfig,
} from "@accountun/contract";
import { readDustAllocationRequests } from "../utilities/csv";
import path from "node:path";

export function registerDustCommand(program: Command) {
  program
    .command("dust")
    .description("Plans and executes dust allocations in Specks")
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
    .option(
      "--refresh-balances",
      "refresh wallet balances from chain into cache before planning",
    )
    .option(
      "--target-window-ms <ms>",
      "time window to hit targetSpecks (default: 1 day)",
      "86400000",
    )
    .option("--request-id <id>", "idempotency key for reconciliation request")
    .action(
      async (options: {
        csv?: string;
        timeoutMs: string;
        mainReservePercent: string;
        refreshBalances?: boolean;
        targetWindowMs: string;
        requestId?: string;
      }) => {
        const requests = options.csv
          ? await readDustAllocationRequests(path.resolve(options.csv))
          : [];

        const timeoutMs = Number.parseInt(options.timeoutMs, 10);
        const targetWindowMs = Number.parseInt(options.targetWindowMs, 10);
        const mainReservePercent = BigInt(options.mainReservePercent);
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          throw new Error("--timeout-ms must be a positive number");
        }
        if (!Number.isFinite(targetWindowMs) || targetWindowMs <= 0) {
          throw new Error("--target-window-ms must be a positive number");
        }
        if (mainReservePercent < 0n || mainReservePercent > 100n) {
          throw new Error("--main-reserve-percent must be between 0 and 100");
        }

        const config = getConfig();

        console.log("ℹ Planning dust allocations");
        const summary = await planDustAllocations(config, requests, {
          requestId: options.requestId,
          timeoutMs,
          mainReservePercent,
          refreshBalances: options.refreshBalances,
          targetWindowMs,
        });

        console.log("ℹ Executing dust allocation plan");
        const execution = await reconcileDustAllocation(
          config,
          summary.actions,
          {
            requestId: `${summary.requestId}-execute`,
            timeoutMs,
            requests,
          },
        );

        console.log("✅ Allocation plan created");
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

        console.log("✅ Allocation plan executed");
        console.log(" Execute request id:", execution.requestId);
        for (const result of execution.results) {
          console.log(" Execution:");
          console.log("  Allocation:", result.allocationId);
          console.log("  Wallet index:", result.walletIndex);
          console.log("  Op:", result.op);
          console.log("  Status:", result.status);
          if (result.txId) {
            console.log("  TxId:", result.txId);
          }
          if (result.reason) {
            console.log("  Reason:", result.reason);
          }
        }
      },
    );
}
