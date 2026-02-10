import { isHex32 } from "@accountun/common";
import type { MidnightConfig, NetworkName, WalletContext } from "./types";
import type { FacadeState } from "@midnight-ntwrk/wallet-sdk-facade";
import { WalletFacade } from "@midnight-ntwrk/wallet-sdk-facade";
import { ShieldedWallet } from "@midnight-ntwrk/wallet-sdk-shielded";
import { DustWallet } from "@midnight-ntwrk/wallet-sdk-dust-wallet";
import {
  createKeystore,
  InMemoryTransactionHistoryStorage,
  PublicKey,
  UnshieldedWallet,
} from "@midnight-ntwrk/wallet-sdk-unshielded-wallet";
import { HDWallet, Roles } from "@midnight-ntwrk/wallet-sdk-hd";
import {
  MidnightBech32m,
  UnshieldedAddress,
} from "@midnight-ntwrk/wallet-sdk-address-format";
import * as ledger from "@midnight-ntwrk/ledger-v7";
import { unshieldedToken } from "@midnight-ntwrk/ledger-v7";
import {
  getNetworkId,
  setNetworkId as setMidnightJsNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";
import {
  bufferCount,
  filter,
  firstValueFrom,
  map,
  shareReplay,
  take,
  tap,
  throttleTime,
  timeout,
} from "rxjs";
import { Buffer } from "buffer";

type WalletState = FacadeState;

const DEFAULT_TTL_MS = 30 * 60 * 1000;

function buildShieldedConfig(config: MidnightConfig) {
  return {
    networkId: getNetworkId(),
    indexerClientConnection: {
      indexerHttpUrl: config.indexerHttpUri,
      indexerWsUrl: config.indexerWsUri,
    },
    provingServerUrl: new URL(config.proofServerUri),
    relayURL: new URL(config.substrateNodeUri.replace(/^http/, "ws")),
  };
}

function buildUnshieldedConfig(config: MidnightConfig) {
  return {
    networkId: getNetworkId(),
    indexerClientConnection: {
      indexerHttpUrl: config.indexerHttpUri,
      indexerWsUrl: config.indexerWsUri,
    },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(),
  };
}

function buildDustConfig(config: MidnightConfig) {
  return {
    networkId: getNetworkId(),
    costParameters: {
      additionalFeeOverhead: 300_000_000_000_000n,
      feeBlocksMargin: 5,
    },
    indexerClientConnection: {
      indexerHttpUrl: config.indexerHttpUri,
      indexerWsUrl: config.indexerWsUri,
    },
    provingServerUrl: new URL(config.proofServerUri),
    relayURL: new URL(config.substrateNodeUri.replace(/^http/, "ws")),
  };
}

function deriveKeysFromSeed(seedHex: string) {
  const hdWallet = HDWallet.fromSeed(Buffer.from(seedHex, "hex"));
  if (hdWallet.type !== "seedOk") {
    throw new Error("Failed to initialize HDWallet from seed");
  }

  const derivationResult = hdWallet.hdWallet
    .selectAccount(0)
    .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
    .deriveKeysAt(0);

  if (derivationResult.type !== "keysDerived") {
    throw new Error("Failed to derive wallet keys");
  }

  hdWallet.hdWallet.clear();
  return derivationResult.keys;
}

/**
 * Builds a wallet from the configured seed using the wallet SDK facade.
 * @param config Config for connecting to midnight while building the wallet
 * @returns a started wallet context
 */
export async function buildWallet(
  config: MidnightConfig,
): Promise<WalletContext> {
  const { serviceWalletSeedHex, network } = config;

  if (!isHex32(serviceWalletSeedHex)) {
    throw new Error(
      "SERVICE_WALLET_SEED_HEX must be 32-byte hex (64 hex chars, no 0x).",
    );
  }

  // Whenever we build a wallet, we need to set the configured matching network ID
  setMidnightJsNetworkId(network);

  const keys = deriveKeysFromSeed(serviceWalletSeedHex);
  const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
  const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
  const unshieldedKeystore = createKeystore(
    keys[Roles.NightExternal],
    getNetworkId(),
  );

  const shieldedWallet = ShieldedWallet(
    buildShieldedConfig(config),
  ).startWithSecretKeys(shieldedSecretKeys);
  const unshieldedWallet = UnshieldedWallet(
    buildUnshieldedConfig(config),
  ).startWithPublicKey(PublicKey.fromKeyStore(unshieldedKeystore));
  const dustWallet = DustWallet(buildDustConfig(config)).startWithSecretKey(
    dustSecretKey,
    ledger.LedgerParameters.initialParameters().dust,
  );

  const wallet = new WalletFacade(shieldedWallet, unshieldedWallet, dustWallet);
  await wallet.start(shieldedSecretKeys, dustSecretKey);

  return {
    wallet,
    shieldedSecretKeys,
    dustSecretKey,
    unshieldedKeystore,
  };
}

/**
 * Then gets the current wallet state without waiting for sync
 * @param wallet the started wallet to get the state from
 * @returns The unsynced wallet state
 */
export async function getWalletStateUnsynced(
  wallet: WalletContext,
): Promise<WalletState> {
  return firstValueFrom(wallet.wallet.state());
}

/**
 * Waits for the wallet to sync to within a certain number of blocks of the latest known block.
 * @param wallet the started wallet instance to wait for sync
 * @param options options for controlling sync behavior
 * @returns The wallet state once synced
 */
export async function getWalletState(
  wallet: WalletContext,
  options?: {
    timeoutMs?: number; // default 3 min
    throttleMs?: number; // progress throttle (default 2s)
    minConsecutive?: number; // require N consecutive ok samples (default 2)
    onProgress?: (p: { synced: boolean }) => void;
  },
): Promise<WalletState> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const throttleMs = options?.throttleMs ?? 2_000;
  const minConsecutive = Math.max(1, options?.minConsecutive ?? 2);

  // One shared, replayed source for both waiting & reading
  const src$ = wallet.wallet
    .state()
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  // Optional progress logging (throttled), does not affect gating
  const progressSub = src$
    .pipe(
      throttleTime(throttleMs, undefined, { leading: true, trailing: true }),
      tap((s: WalletState) => {
        if (!options?.onProgress) return;
        options.onProgress({ synced: s.isSynced });
      }),
    )
    .subscribe();

  try {
    type Gate = { state: WalletState; ok: boolean };
    // Gate: wait until within threshold (unthrottled)
    const gate$ = src$.pipe(
      map<WalletState, Gate>((state) => ({
        state,
        ok: state.isSynced,
      })),
      bufferCount(minConsecutive, 1),
      filter(
        (buffer: Gate[]) =>
          buffer.length === minConsecutive && buffer.every((g) => g.ok),
      ),
      map((buffer: Gate[]) => buffer[buffer.length - 1]!.state),
      take(1),
    );

    const withTimeout =
      timeoutMs > 0 ? gate$.pipe(timeout({ each: timeoutMs })) : gate$;

    return await firstValueFrom(withTimeout);
  } finally {
    progressSub.unsubscribe();
  }
}

/**
 * Wait for wallet to be synced and then finds the balance of the specified asset (or native token if none specified)
 * @param wallet the started wallet instance to get the balance from
 * @param optitons options for controlling balance fetch behavior
 * @returns  The balance of the specified asset (or native token if none specified)
 */
export async function getTokenBalance(
  wallet: WalletContext,
  options?: {
    assetId?: string; // defaults to unshieldedToken().raw
    timeoutMs?: number; // default 120s
    onProgress?: (info: { synced: boolean }) => void;
  },
): Promise<bigint> {
  const assetId = options?.assetId ?? unshieldedToken().raw;
  const timeoutMs = options?.timeoutMs ?? 120_000;

  const state = await getWalletState(wallet, {
    timeoutMs,
  });

  return state.unshielded.balances?.[assetId] ?? 0n;
}

/**
 * Utility to send unshielded tNight from the wallet to a receiver address
 * @param wallet The wallet to send tNight from
 * @param receiverAddress The receiver of the tNight
 * @param amount The amount of tNight to send
 * @returns
 */
export async function sendNativeToken(
  wallet: WalletContext,
  receiverAddress: string,
  amount: bigint,
) {
  if (amount <= 0n) {
    throw new Error("Amount must be positive");
  }

  const networkId = getNetworkId();
  const unshieldedAddress = MidnightBech32m.parse(receiverAddress).decode(
    UnshieldedAddress,
    networkId,
  );

  const recipe = await wallet.wallet.transferTransaction(
    [
      {
        type: "unshielded",
        outputs: [
          {
            amount,
            type: unshieldedToken().raw,
            receiverAddress: unshieldedAddress.hexString,
          },
        ],
      },
    ],
    {
      shieldedSecretKeys: wallet.shieldedSecretKeys,
      dustSecretKey: wallet.dustSecretKey,
    },
    { ttl: new Date(Date.now() + DEFAULT_TTL_MS) },
  );

  const signedTx = await wallet.wallet.signUnprovenTransaction(
    recipe.transaction,
    (payload) => wallet.unshieldedKeystore.signData(payload),
  );
  const finalized = await wallet.wallet.finalizeTransaction(signedTx);
  return await wallet.wallet.submitTransaction(finalized);
}

/**
 * Utility wrapper that starts a wallet, invokes a function, and then closes the wallet.
 * @param config Config for building the wallet
 * @param fn function to invoke using the started wallet
 * @returns the result of the function invocation
 */
export async function withWallet<T>(
  config: MidnightConfig,
  fn: (wallet: WalletContext) => Promise<T>,
): Promise<T> {
  const wallet = await buildWallet(config);
  try {
    return await fn(wallet);
  } finally {
    await wallet.wallet.stop();
  }
}
