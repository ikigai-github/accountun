import { Command } from "commander";
import {
  buildWallet,
  getTokenBalance as getTokenBalance,
  getWalletState,
  saveWallet,
  withWallet,
} from "@accountun/contract";
import { getConfig } from "../config";
import { last, lastValueFrom } from "rxjs";

export function registerWalletCommand(program: Command) {
  program
    .command("wallet")
    .description(
      "Construct the wallet from seed hex and print its address and balance",
    )
    .action(async () => {
      const config = getConfig();
      await withWallet(config, async (wallet) => {
        // Sync wallet and get current state
        const state = await getWalletState(wallet);

        // Save the wallet to disk for future runs
        await saveWallet(config.network, config.stateDir, wallet);

        console.log("🌐 Network:", config.network);
        console.log("🔑 Wallet address:", state.address);
        console.log("✨ Dust balance:", await getTokenBalance(wallet));
      });
    });
}
