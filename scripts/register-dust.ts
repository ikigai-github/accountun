import { getConfig } from "../packages/contract/config";
import { allocateDust, buildWallet } from "../packages/contract/wallet";

async function main() {
  const config = getConfig();
  console.info(
    `[dust] network=${config.network} node=${config.substrateNodeUri} indexer=${config.indexerHttpUri} proof=${config.proofServerUri}`,
  );

  const wallet = await buildWallet(config);
  try {
    const result = await allocateDust(wallet, { timeoutMs: 120_000 });
    if (!result) {
      console.info("[dust] no eligible UTXOs to register.");
      return;
    }
    console.info(
      `[dust] registered ${result.registeredUtxos} UTXOs (tx ${result.txId})`,
    );
  } finally {
    await wallet.wallet.stop();
  }
}

main().catch((error) => {
  console.error("[dust] failed:", error);
  process.exitCode = 1;
});
