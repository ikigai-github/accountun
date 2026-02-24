import { getConfig } from "../packages/contract/config";
import {
  buildWallet,
  getUnshieldedBalance,
  registerAvailableDustCoins,
  sendUnshieldedToken,
} from "../packages/contract/wallet";

const GENESIS_WALLET_SEED_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";

const AMOUNT = BigInt(process.env.FUND_AMOUNT ?? "10000000000"); // 10000 NIGHT

async function main() {
  const baseConfig = getConfig();
  console.info(
    `[fund] network=${baseConfig.network} node=${baseConfig.substrateNodeUri} indexer=${baseConfig.indexerHttpUri} proof=${baseConfig.proofServerUri}`,
  );

  const isLocal =
    baseConfig.substrateNodeUri.includes("127.0.0.1") ||
    baseConfig.substrateNodeUri.includes("localhost");
  if (!isLocal || baseConfig.network !== "undeployed") {
    throw new Error(
      "fund-local requires NETWORK=undeployed and local endpoints (127.0.0.1/localhost).",
    );
  }

  const receiverWallet = await buildWallet(baseConfig);
  try {
    const receiverAddress = receiverWallet.unshieldedKeystore
      .getBech32Address()
      .toString();

    const senderConfig = {
      ...baseConfig,
      serviceWalletSeedHex: GENESIS_WALLET_SEED_HEX,
    };
    const senderWallet = await buildWallet(senderConfig);
    try {
      const dustResult = await registerAvailableDustCoins(senderWallet, {
        timeoutMs: 120_000,
      });
      if (dustResult) {
        console.info(
          `[fund] registered ${dustResult.registeredCoins} coins for dust (tx ${dustResult.txId})`,
        );
      }

      const senderBalance = await getUnshieldedBalance(senderWallet, {
        timeoutMs: 120_000,
      });
      let amountToSend = AMOUNT;
      if (senderBalance < AMOUNT) {
        amountToSend = senderBalance / 2n;
        if (amountToSend <= 0n) {
          throw new Error(
            `Genesis sender has insufficient funds: ${senderBalance.toString()}`,
          );
        }
        console.info(
          `[fund] requested amount exceeds balance; sending ${amountToSend.toString()} instead`,
        );
      }

      const txId = await sendUnshieldedToken(
        senderWallet,
        receiverAddress,
        amountToSend,
      );
      console.info(`[fund] submitted tx: ${txId}`);
    } finally {
      await senderWallet.wallet.stop();
    }
  } finally {
    await receiverWallet.wallet.stop();
  }
}

main().catch((error) => {
  console.error("[fund] failed:", error);
  process.exitCode = 1;
});
