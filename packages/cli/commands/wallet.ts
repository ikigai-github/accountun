import { Command } from "commander";
import {
  buildWallet,
  getShieldedBalance,
  getUnshieldedBalance,
  getWalletState,
} from "@accountun/contract";
import { getConfig } from "@accountun/contract";

type DustGenerationStatus = {
  cardanoRewardAddress: string;
  dustAddress: string | null;
  registered: boolean;
  generationRate: string;
  nightBalance: string;
  currentCapacity: string;
  maxCapacity: string;
};

const SPECKS_PER_DUST = 10n ** 15n;
const STARS_PER_NIGHT = 10n ** 6n;

function formatScaledAmount(
  amount: bigint,
  scale: bigint,
  decimals: number,
): string {
  const whole = amount / scale;
  const fraction = amount % scale;
  if (fraction === 0n) {
    return whole.toString();
  }

  const fractionText = fraction
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${whole.toString()}.${fractionText}`;
}

function formatSpecksAsDust(specks: bigint): string {
  return formatScaledAmount(specks, SPECKS_PER_DUST, 15);
}

function formatStarsAsNight(stars: bigint): string {
  return formatScaledAmount(stars, STARS_PER_NIGHT, 6);
}

async function fetchDustGenerationStatus(
  indexerHttpUri: string,
  rewardAddress: string,
): Promise<DustGenerationStatus | null> {
  const query = `
    query DustGenerationStatus($addresses: [CardanoRewardAddress!]!) {
      dustGenerationStatus(cardanoRewardAddresses: $addresses) {
        cardanoRewardAddress
        dustAddress
        registered
        generationRate
        nightBalance
        currentCapacity
        maxCapacity
      }
    }
  `;

  const response = await fetch(indexerHttpUri, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      variables: { addresses: [rewardAddress] },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to query dust generation status: HTTP ${response.status}`,
    );
  }

  const payload = (await response.json()) as {
    data?: { dustGenerationStatus?: DustGenerationStatus[] };
    errors?: Array<{ message?: string }>;
  };

  if (payload.errors && payload.errors.length > 0) {
    const message = payload.errors
      .map((error) => error.message)
      .filter((value): value is string => Boolean(value))
      .join("; ");
    throw new Error(
      `Failed to query dust generation status: ${message || "Unknown GraphQL error"}`,
    );
  }

  return payload.data?.dustGenerationStatus?.[0] ?? null;
}

export function registerWalletCommand(program: Command) {
  program
    .command("wallet")
    .description(
      "Construct a wallet by account index and print addresses, balances, and dust details",
    )
    .option("--index <index>", "wallet account index (default: 0)", "0")
    .option(
      "--reward-address <address>",
      "optional Cardano reward address (stake_...) for dust receiver validation",
    )
    .action(async (options: { index: string; rewardAddress?: string }) => {
      const accountIndex = Number.parseInt(options.index, 10);
      if (!Number.isInteger(accountIndex) || accountIndex < 0) {
        throw new Error("--index must be a non-negative integer");
      }

      const config = getConfig();
      const wallet = await buildWallet(config, { accountIndex });
      try {
        // Sync wallet and get current state
        console.log("ℹ Fetching wallet state from network");
        const state = await getWalletState(wallet);

        console.log("🌐 Network:", config.network);
        console.log("🔢 Account index:", accountIndex);
        console.log("🔐 Public key:", wallet.unshieldedKeystore.getPublicKey());
        console.log(
          "🔑 Unshielded address:",
          wallet.unshieldedKeystore.getBech32Address().toString(),
        );
        console.log(
          "✨ Native token balance:",
          `${formatStarsAsNight(await getUnshieldedBalance(wallet))} NIGHT`,
        );
        console.log(
          "🛡️ Shielded token balance:",
          `${formatStarsAsNight(await getShieldedBalance(wallet))} NIGHT`,
        );
        console.log(
          "🪙 Dust balance:",
          formatSpecksAsDust(state.dust.walletBalance(new Date())),
        );
        console.log("🪙 Dust address:", state.dust.dustAddress);

        if (options.rewardAddress) {
          console.log(
            "ℹ Querying dust generation status for reward address:",
            options.rewardAddress,
          );

          const status = await fetchDustGenerationStatus(
            config.indexerHttpUri,
            options.rewardAddress,
          );

          if (!status) {
            console.log("ℹ No dust generation status found for reward address");
          } else {
            console.log("🧾 Reward address:", status.cardanoRewardAddress);
            console.log("🧾 Registered:", status.registered);
            console.log(
              "🧾 Receiver dust address:",
              status.dustAddress ?? "(none)",
            );
            console.log("🧾 Generation rate:", status.generationRate);
            console.log("🧾 NIGHT backing:", status.nightBalance);
            console.log("🧾 Current capacity:", status.currentCapacity);
            console.log("🧾 Max capacity:", status.maxCapacity);
          }
        }
      } finally {
        await wallet.wallet.stop();
      }
    });
}
