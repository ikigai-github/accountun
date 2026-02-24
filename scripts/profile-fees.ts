import {
  buildWallet,
  completeTournament,
  createContract,
  createProviders,
  deployContract,
  getConfig,
  getWalletState,
  getUnshieldedBalance,
  payoutReady,
  planPayout,
  postResults,
  recordFunding,
  recordReceipt,
  registerTournament,
  saveAddress,
  sendUnshieldedToken,
  waitForWalletSyncAdvance,
} from "../packages/contract";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const GENESIS_WALLET_SEED_HEX =
  "0000000000000000000000000000000000000000000000000000000000000001";
const TOP_UP_AMOUNT = 300_000_000n;
const MIN_REQUIRED_BALANCE = 150_000_000n;
const TRANSFER_AMOUNT = BigInt(
  process.env.PROFILE_TRANSFER_AMOUNT ?? "1000000",
);
const SPECKS_PER_DUST = 10n ** 15n;
const STARS_PER_NIGHT = 10n ** 6n;
const RUN_CONTRACT_FLOW = true;

type FeeResult = {
  operation: string;
  txId: string;
  before: bigint;
  after: bigint;
  delta: bigint;
  valueSent: bigint;
  dustBefore: bigint;
  dustAfter: bigint;
  dustDelta: bigint;
  dustBeforeAtAnchor: bigint;
  dustAfterAtAnchor: bigint;
  dustDeltaAtAnchor: bigint;
  dustEstimatedFee: bigint;
  estimatedFee: bigint;
};

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

function getDefaultCsvPath(cacheDir: string): string {
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  return path.join(cacheDir, "fee-profiles", `profile-fees-${timestamp}.csv`);
}

async function writeResultsCsv(
  outputPath: string,
  config: ReturnType<typeof getConfig>,
  runStartedAt: string,
  rows: FeeResult[],
): Promise<void> {
  const header = [
    "runStartedAt",
    "network",
    "operation",
    "txId",
    "nightBefore",
    "nightAfter",
    "nightDelta",
    "nightValueSent",
    "dustBefore",
    "dustAfter",
    "dustDelta",
    "dustBeforeAtAnchor",
    "dustAfterAtAnchor",
    "dustDeltaAtAnchor",
    "dustEstimatedFee",
    "estimatedFee",
  ];

  const lines = [
    header.join(","),
    ...rows.map((row) =>
      [
        runStartedAt,
        config.network,
        row.operation,
        row.txId,
        formatStarsAsNight(row.before),
        formatStarsAsNight(row.after),
        formatStarsAsNight(row.delta),
        formatStarsAsNight(row.valueSent),
        formatSpecksAsDust(row.dustBefore),
        formatSpecksAsDust(row.dustAfter),
        formatSpecksAsDust(row.dustDelta),
        formatSpecksAsDust(row.dustBeforeAtAnchor),
        formatSpecksAsDust(row.dustAfterAtAnchor),
        formatSpecksAsDust(row.dustDeltaAtAnchor),
        formatSpecksAsDust(row.dustEstimatedFee),
        formatSpecksAsDust(row.estimatedFee),
      ]
        .map((cell) => csvEscape(cell))
        .join(","),
    ),
  ];

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${lines.join("\n")}\n`, "utf8");
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function extractTxId(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (
    value &&
    typeof value === "object" &&
    "public" in value &&
    value.public &&
    typeof value.public === "object" &&
    "txId" in value.public &&
    typeof value.public.txId === "string"
  ) {
    return value.public.txId;
  }

  if (
    value &&
    typeof value === "object" &&
    "deployTxData" in value &&
    value.deployTxData &&
    typeof value.deployTxData === "object" &&
    "public" in value.deployTxData &&
    value.deployTxData.public &&
    typeof value.deployTxData.public === "object" &&
    "txId" in value.deployTxData.public &&
    typeof value.deployTxData.public.txId === "string"
  ) {
    return value.deployTxData.public.txId;
  }

  throw new Error("Unable to extract txId from transaction result");
}

function randomUuid(): string {
  return crypto.randomUUID();
}

function toNonNegative(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function formatScaledAmount(
  amount: bigint,
  scale: bigint,
  decimals: number,
): string {
  const isNegative = amount < 0n;
  const normalizedAmount = isNegative ? -amount : amount;
  const whole = normalizedAmount / scale;
  const fraction = normalizedAmount % scale;
  if (fraction === 0n) {
    const text = whole.toString();
    return isNegative ? `-${text}` : text;
  }

  const fractionText = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  const text = `${whole.toString()}.${fractionText}`;
  return isNegative ? `-${text}` : text;
}

function formatSpecksAsDust(specks: bigint): string {
  return formatScaledAmount(specks, SPECKS_PER_DUST, 15);
}

function formatStarsAsNight(stars: bigint): string {
  return formatScaledAmount(stars, STARS_PER_NIGHT, 6);
}

function computeFeeBreakdown(
  before: bigint,
  after: bigint,
  dustDeltaAtAnchor: bigint,
): {
  delta: bigint;
  dustEstimatedFee: bigint;
  estimatedFee: bigint;
} {
  const delta = before - after;
  const dustEstimatedFee = toNonNegative(dustDeltaAtAnchor);

  return {
    delta,
    dustEstimatedFee,
    estimatedFee: dustEstimatedFee,
  };
}

async function waitForConfirmationBestEffort(
  wallet: Awaited<ReturnType<typeof buildWallet>>,
  baselineState: Awaited<ReturnType<typeof getWalletState>>,
  txId: string,
  timeoutMs: number,
): Promise<void> {
  try {
    await waitForWalletSyncAdvance(wallet, {
      baselineState,
      timeoutMs,
      txId,
    });
    return;
  } catch (error) {
    console.warn(
      `[profile-fees] sync advancement timeout for tx ${txId}; continuing after grace delay (${toErrorMessage(error)})`,
    );
    await new Promise((resolve) => setTimeout(resolve, 12_000));
    await getWalletState(wallet, { timeoutMs: Math.min(timeoutMs, 60_000) });
  }
}

async function ensureFundedLocalWallet(
  serviceWallet: Awaited<ReturnType<typeof buildWallet>>,
  timeoutMs: number,
): Promise<void> {
  const config = getConfig();
  let serviceBalance = await getUnshieldedBalance(serviceWallet, { timeoutMs });

  if (serviceBalance >= MIN_REQUIRED_BALANCE) {
    return;
  }

  const serviceAddress = serviceWallet.unshieldedKeystore
    .getBech32Address()
    .toString();
  const genesisWallet = await buildWallet({
    ...config,
    serviceWalletSeedHex: GENESIS_WALLET_SEED_HEX,
  });

  try {
    const genesisAddress = genesisWallet.unshieldedKeystore
      .getBech32Address()
      .toString();

    if (genesisAddress === serviceAddress) {
      return;
    }

    const baseline = await getUnshieldedBalance(serviceWallet, { timeoutMs });

    const baselineState = await getWalletState(serviceWallet, { timeoutMs });

    const txId = await sendUnshieldedToken(
      genesisWallet,
      serviceAddress,
      TOP_UP_AMOUNT,
    );
    await waitForConfirmationBestEffort(
      serviceWallet,
      baselineState,
      txId,
      timeoutMs,
    );

    serviceBalance = await getUnshieldedBalance(serviceWallet, { timeoutMs });
    if (serviceBalance <= baseline) {
      throw new Error("Top-up transaction did not increase service balance");
    }
  } finally {
    await genesisWallet.wallet.stop();
  }
}

async function measureTx(
  operation: string,
  wallet: Awaited<ReturnType<typeof buildWallet>>,
  runTx: () => Promise<unknown>,
  options?: { timeoutMs?: number; valueSent?: bigint },
): Promise<FeeResult> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const valueSent = options?.valueSent ?? 0n;

  console.info(`[profile-fees] starting ${operation}`);

  const beforeState = await getWalletState(wallet, { timeoutMs });
  const before = await getUnshieldedBalance(wallet, { timeoutMs });
  const beforeObservedAt = new Date();
  const baselineState = beforeState;

  const txResult = await runTx();
  const txId = extractTxId(txResult);

  await waitForConfirmationBestEffort(wallet, baselineState, txId, timeoutMs);

  const afterState = await getWalletState(wallet, { timeoutMs });
  const after = await getUnshieldedBalance(wallet, { timeoutMs });
  const afterObservedAt = new Date();
  const feeAnchorTime = afterObservedAt;

  const dustBefore = beforeState.dust.walletBalance(beforeObservedAt);
  const dustAfter = afterState.dust.walletBalance(afterObservedAt);
  const dustDelta = dustBefore - dustAfter;

  const dustBeforeAtAnchor = beforeState.dust.walletBalance(feeAnchorTime);
  const dustAfterAtAnchor = afterState.dust.walletBalance(feeAnchorTime);
  const dustDeltaAtAnchor = dustBeforeAtAnchor - dustAfterAtAnchor;

  const { delta, dustEstimatedFee, estimatedFee } = computeFeeBreakdown(
    before,
    after,
    dustDeltaAtAnchor,
  );

  console.info(
    `[profile-fees] completed ${operation} txId=${txId} fee=${formatSpecksAsDust(estimatedFee)} DUST (observedDelta=${formatSpecksAsDust(dustDelta)} DUST anchorDelta=${formatSpecksAsDust(dustDeltaAtAnchor)} DUST)`,
  );

  return {
    operation,
    txId,
    before,
    after,
    delta,
    valueSent,
    dustBefore,
    dustAfter,
    dustDelta,
    dustBeforeAtAnchor,
    dustAfterAtAnchor,
    dustDeltaAtAnchor,
    dustEstimatedFee,
    estimatedFee,
  };
}

async function main() {
  const config = getConfig();
  const timeoutMs = Number(process.env.PROFILE_TIMEOUT_MS ?? "240000");
  const runStartedAt = new Date().toISOString();
  const csvPath =
    process.env.PROFILE_CSV_PATH?.trim() || getDefaultCsvPath(config.cacheDir);

  const wallet = await buildWallet(config);
  try {
    console.info("[profile-fees] wallet initialized");
    const isLocalUndeployed =
      process.env.NETWORK_MODE === "local" && config.network === "undeployed";
    if (isLocalUndeployed) {
      await ensureFundedLocalWallet(wallet, timeoutMs);
      console.info("[profile-fees] service wallet funded");
    }

    const results: FeeResult[] = [];
    // Set RUN_CONTRACT_FLOW to true when you want the full contract/deploy profiling sequence.
    if (RUN_CONTRACT_FLOW) {
      const providers = await createProviders(config, wallet);
      const contract = createContract();
      const privateState = {
        secretKey: config.authSecret,
        replacementKey: config.authReplacementKey ?? config.authSecret,
      };

      console.info("[profile-fees] starting deployContract");
      const deployBeforeState = await getWalletState(wallet, { timeoutMs });
      const deployBefore = await getUnshieldedBalance(wallet, { timeoutMs });
      const deployBeforeObservedAt = new Date();
      const deployBaseline = deployBeforeState;
      const deployed = await deployContract(
        privateState.secretKey,
        contract,
        providers,
        privateState,
      );
      const deployedAddress = deployed.deployTxData.public.contractAddress;
      await saveAddress(config.cacheDir, config.network, deployedAddress);

      const deployTxId = extractTxId(deployed);
      await waitForConfirmationBestEffort(
        wallet,
        deployBaseline,
        deployTxId,
        timeoutMs,
      );
      const deployAfterState = await getWalletState(wallet, { timeoutMs });
      const deployAfter = await getUnshieldedBalance(wallet, { timeoutMs });
      const deployAfterObservedAt = new Date();
      const deployFeeAnchorTime = deployAfterObservedAt;

      const deployDustBefore = deployBeforeState.dust.walletBalance(
        deployBeforeObservedAt,
      );
      const deployDustAfter = deployAfterState.dust.walletBalance(
        deployAfterObservedAt,
      );
      const deployDustDelta = deployDustBefore - deployDustAfter;

      const deployDustBeforeAtAnchor =
        deployBeforeState.dust.walletBalance(deployFeeAnchorTime);
      const deployDustAfterAtAnchor =
        deployAfterState.dust.walletBalance(deployFeeAnchorTime);
      const deployDustDeltaAtAnchor =
        deployDustBeforeAtAnchor - deployDustAfterAtAnchor;

      const {
        delta: deployDelta,
        dustEstimatedFee: deployDustEstimatedFee,
        estimatedFee: deployEstimatedFee,
      } = computeFeeBreakdown(
        deployBefore,
        deployAfter,
        deployDustDeltaAtAnchor,
      );
      console.info(
        `[profile-fees] completed deployContract txId=${deployTxId} fee=${formatSpecksAsDust(deployEstimatedFee)} DUST (observedDelta=${formatSpecksAsDust(deployDustDelta)} DUST anchorDelta=${formatSpecksAsDust(deployDustDeltaAtAnchor)} DUST)`,
      );

      results.push({
        operation: "deployContract",
        txId: deployTxId,
        before: deployBefore,
        after: deployAfter,
        delta: deployDelta,
        valueSent: 0n,
        dustBefore: deployDustBefore,
        dustAfter: deployDustAfter,
        dustDelta: deployDustDelta,
        dustBeforeAtAnchor: deployDustBeforeAtAnchor,
        dustAfterAtAnchor: deployDustAfterAtAnchor,
        dustDeltaAtAnchor: deployDustDeltaAtAnchor,
        dustEstimatedFee: deployDustEstimatedFee,
        estimatedFee: deployEstimatedFee,
      });

      const tournamentId = randomUuid();
      const fundingEntityId = randomUuid();
      const playerOneId = randomUuid();
      const playerTwoId = randomUuid();
      const timestamp = Math.floor(Date.now() / 1000);

      results.push(
        await measureTx(
          "registerTournament",
          wallet,
          async () => registerTournament(deployed, tournamentId, "usd"),
          { timeoutMs },
        ),
      );

      results.push(
        await measureTx(
          "recordFunding",
          wallet,
          async () =>
            recordFunding(deployed, tournamentId, {
              timestamp: String(timestamp),
              entityId: fundingEntityId,
              amount: "1000",
            }),
          { timeoutMs },
        ),
      );

      results.push(
        await measureTx(
          "postResults",
          wallet,
          async () =>
            postResults(deployed, tournamentId, [playerOneId, playerTwoId]),
          { timeoutMs },
        ),
      );

      results.push(
        await measureTx(
          "planPayout#1",
          wallet,
          async () =>
            planPayout(deployed, tournamentId, {
              timestamp: String(timestamp + 1),
              entityId: playerOneId,
              amount: "600",
            }),
          { timeoutMs },
        ),
      );

      results.push(
        await measureTx(
          "planPayout#2",
          wallet,
          async () =>
            planPayout(deployed, tournamentId, {
              timestamp: String(timestamp + 1),
              entityId: playerTwoId,
              amount: "400",
            }),
          { timeoutMs },
        ),
      );

      results.push(
        await measureTx(
          "payoutReady",
          wallet,
          async () => payoutReady(deployed, tournamentId),
          { timeoutMs },
        ),
      );

      results.push(
        await measureTx(
          "recordReceipt#1",
          wallet,
          async () =>
            recordReceipt(deployed, tournamentId, {
              timestamp: String(timestamp + 2),
              entityId: playerOneId,
              amount: "600",
            }),
          { timeoutMs },
        ),
      );

      results.push(
        await measureTx(
          "recordReceipt#2",
          wallet,
          async () =>
            recordReceipt(deployed, tournamentId, {
              timestamp: String(timestamp + 2),
              entityId: playerTwoId,
              amount: "400",
            }),
          { timeoutMs },
        ),
      );

      results.push(
        await measureTx(
          "completeTournament",
          wallet,
          async () => completeTournament(deployed, tournamentId),
          { timeoutMs },
        ),
      );
    } else {
      console.info(
        "[profile-fees] full contract profiling disabled; running sendUnshieldedToken only",
      );
    }

    const receiverWallet = await buildWallet(config, { accountIndex: 1 });
    try {
      const receiverAddress = receiverWallet.unshieldedKeystore
        .getBech32Address()
        .toString();

      results.push(
        await measureTx(
          "sendUnshieldedToken",
          wallet,
          async () =>
            sendUnshieldedToken(wallet, receiverAddress, TRANSFER_AMOUNT),
          { timeoutMs, valueSent: TRANSFER_AMOUNT },
        ),
      );
    } finally {
      await receiverWallet.wallet.stop();
    }

    const table = results.map((row) => ({
      operation: row.operation,
      txId: row.txId,
      nightBefore: `${formatStarsAsNight(row.before)} NIGHT`,
      nightAfter: `${formatStarsAsNight(row.after)} NIGHT`,
      nightDelta: `${formatStarsAsNight(row.delta)} NIGHT`,
      nightValueSent: `${formatStarsAsNight(row.valueSent)} NIGHT`,
      dustBefore: `${formatSpecksAsDust(row.dustBefore)} DUST`,
      dustAfter: `${formatSpecksAsDust(row.dustAfter)} DUST`,
      dustDelta: `${formatSpecksAsDust(row.dustDelta)} DUST`,
      dustBeforeAtAnchor: `${formatSpecksAsDust(row.dustBeforeAtAnchor)} DUST`,
      dustAfterAtAnchor: `${formatSpecksAsDust(row.dustAfterAtAnchor)} DUST`,
      dustDeltaAtAnchor: `${formatSpecksAsDust(row.dustDeltaAtAnchor)} DUST`,
      dustEstimatedFee: `${formatSpecksAsDust(row.dustEstimatedFee)} DUST`,
      estimatedFee: `${formatSpecksAsDust(row.estimatedFee)} DUST`,
    }));

    console.table(table);
    await writeResultsCsv(csvPath, config, runStartedAt, results);
    console.info(`[profile-fees] csv written: ${csvPath}`);
  } finally {
    await wallet.wallet.stop();
  }
}

main().catch((error) => {
  console.error("[profile-fees] failed:", toErrorMessage(error));
  process.exitCode = 1;
});
