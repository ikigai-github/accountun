import { describe, expect, it } from "bun:test";
import {
  buildWallet,
  completeTournament,
  createContract,
  createProviders,
  deployContract,
  getWalletState,
  payoutReady,
  planPayout,
  postResults,
  recordFunding,
  recordReceipt,
  registerTournament,
} from "../../index";
import { buildIntegrationConfig } from "./config";
import { createTournamentLifecycleFixture } from "./fixtures/tournament-lifecycle";

describe("tournament contract integration", () => {
  it("runs full tournament lifecycle with 2 players (60/40)", async () => {
    const seedHex = process.env.SERVICE_WALLET_SEED_HEX;
    if (!seedHex) {
      throw new Error("SERVICE_WALLET_SEED_HEX must be set");
    }

    const config = buildIntegrationConfig(seedHex);
    console.info(
      `[integration] endpoints: node=${config.substrateNodeUri} indexer=${config.indexerHttpUri} proof=${config.proofServerUri}`,
    );

    const wallet = await buildWallet(config);
    try {
      const state = await getWalletState(wallet, { timeoutMs: 120_000 });
      console.info(
        `[integration] wallet address=${wallet.unshieldedKeystore
          .getBech32Address()
          .toString()}`,
      );
      console.info(`[integration] dust address=${state.dust.dustAddress}`);
      console.info(
        `[integration] dust balance=${state.dust.walletBalance(new Date()).toString()}`,
      );

      const providers = await createProviders(config, wallet);
      const contract = createContract();
      const privateState = {
        secretKey: config.authSecret,
        replacementKey: config.authReplacementKey ?? config.authSecret,
      };

      console.info("[integration] deploying contract");
      const deployed = await deployContract(
        privateState.secretKey,
        contract,
        providers,
        privateState,
      );

      const fixture = createTournamentLifecycleFixture();

      console.info("[integration] register tournament");
      const registered = await registerTournament(
        deployed,
        fixture.tournamentId,
        fixture.cashAssetName,
      );
      expect(registered.public.txId).toBeTruthy();

      console.info("[integration] record funding");
      const fundingTx = await recordFunding(
        deployed,
        fixture.tournamentId,
        fixture.funding,
      );
      expect(fundingTx.public.txId).toBeTruthy();

      console.info("[integration] post results");
      const resultsTx = await postResults(
        deployed,
        fixture.tournamentId,
        fixture.results,
      );
      expect(resultsTx.public.txId).toBeTruthy();

      console.info("[integration] plan payout 1/2");
      const payoutOneTx = await planPayout(
        deployed,
        fixture.tournamentId,
        fixture.payouts[0],
      );
      expect(payoutOneTx.public.txId).toBeTruthy();

      console.info("[integration] plan payout 2/2");
      const payoutTwoTx = await planPayout(
        deployed,
        fixture.tournamentId,
        fixture.payouts[1],
      );
      expect(payoutTwoTx.public.txId).toBeTruthy();

      console.info("[integration] mark payout ready");
      const readyTx = await payoutReady(deployed, fixture.tournamentId);
      expect(readyTx.public.txId).toBeTruthy();

      console.info("[integration] record receipt 1/2");
      const receiptOneTx = await recordReceipt(
        deployed,
        fixture.tournamentId,
        fixture.receipts[0],
      );
      expect(receiptOneTx.public.txId).toBeTruthy();

      console.info("[integration] record receipt 2/2");
      const receiptTwoTx = await recordReceipt(
        deployed,
        fixture.tournamentId,
        fixture.receipts[1],
      );
      expect(receiptTwoTx.public.txId).toBeTruthy();

      console.info("[integration] mark payout complete");
      const completeTx = await completeTournament(
        deployed,
        fixture.tournamentId,
      );
      expect(completeTx.public.txId).toBeTruthy();
    } finally {
      await wallet.wallet.stop();
    }
  });
});
