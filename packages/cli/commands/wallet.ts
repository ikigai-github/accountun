import { Command } from "commander";
import {
  getTokenBalance,
  getWalletState,
  saveWallet,
  withWallet,
} from "@accountun/contract";
import { getConfig } from "@accountun/contract";

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
        console.log("ℹ Fetching wallet state from network");
        const state = await getWalletState(wallet);

        // Save the wallet to disk for future runs
        console.log("ℹ Saving wallet to disk");
        await saveWallet(config.network, config.cacheDir, wallet);

        console.log("🌐 Network:", config.network);
        console.log("🔑 Wallet address:", state.address);
        console.log("✨ Dust balance:", await getTokenBalance(wallet));
      });
    });
}
