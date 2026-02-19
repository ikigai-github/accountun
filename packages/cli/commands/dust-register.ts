import { Command } from "commander";
import {
  getConfig,
  registerAvailableDustCoins,
  withWallet,
} from "@accountun/contract";

export function registerDustRegisterCommand(program: Command) {
  program
    .command("dust-register")
    .description("Registers eligible NIGHT coins for dust generation")
    .option(
      "--dust-receiver-address <address>",
      "optional dust receiver address",
    )
    .option(
      "--timeout-ms <ms>",
      "wallet sync/operation timeout in ms",
      "120000",
    )
    .action(
      async (options: { dustReceiverAddress?: string; timeoutMs: string }) => {
        const timeoutMs = Number.parseInt(options.timeoutMs, 10);
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
          throw new Error("--timeout-ms must be a positive number");
        }

        const config = getConfig();
        await withWallet(config, async (wallet) => {
          const result = await registerAvailableDustCoins(wallet, {
            dustReceiverAddress: options.dustReceiverAddress,
            timeoutMs,
          });

          if (!result) {
            console.log("ℹ No eligible coins to register for dust generation");
            return;
          }

          console.log("✅ Registered dust generation coins");
          console.log(" Tx id:", result.txId);
          console.log(" Registered coins:", result.registeredCoins);
        });
      },
    );
}
