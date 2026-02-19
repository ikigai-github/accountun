import { Command } from "commander";
import {
  getShieldedBalance,
  getUnshieldedBalance,
  getWalletState,
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

        console.log("🌐 Network:", config.network);
        console.log(
          "🔑 Unshielded address:",
          wallet.unshieldedKeystore.getBech32Address().toString(),
        );
        console.log(
          "✨ Native token balance:",
          await getUnshieldedBalance(wallet),
        );
        console.log(
          "🛡️ Shielded token balance:",
          await getShieldedBalance(wallet),
        );
        console.log(
          "🪙 Dust balance:",
          state.dust.walletBalance(new Date()).toString(),
        );
        console.log("🪙 Dust address:", state.dust.dustAddress);
      });
    });
}
