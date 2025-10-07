import { WalletBuilder } from "@midnight-ntwrk/wallet";
import { fileExists, isHex32, readFile, writeFile } from "@accountun/common";

import { type MidnightConfig, type NetworkName, type Wallet } from "./types";

import type { WalletState } from "@midnight-ntwrk/wallet-api";

import {
  bufferCount,
  filter,
  firstValueFrom,
  map,
  scan,
  shareReplay,
  take,
  tap,
  throttleTime,
  timeout,
} from "rxjs";
import {
  setNetworkId as setMidnightJsNetworkId,
  NetworkId as MidnightJsNetworkId,
} from "@midnight-ntwrk/midnight-js-network-id";

import { NetworkId as ZSwapNetworkId } from "@midnight-ntwrk/compact-runtime";

import path from "node:path";
import { nativeToken } from "@midnight-ntwrk/ledger";

/**
 * Maps from a string network name to the corresponding midnight-js-network-id enum value
 * @param name the name of the network (mainnet, testnet, devnet, undeployed)
 * @returns the corresponding midnight-js-network-id NetworkId
 */
function networkNameToMidnightJsNetworkId(name: string): MidnightJsNetworkId {
  switch (name.toLowerCase()) {
    case "mainnet":
      return MidnightJsNetworkId.MainNet;
    case "devnet":
      return MidnightJsNetworkId.DevNet;
    case "testnet":
      return MidnightJsNetworkId.TestNet;
    case "undeployed":
    default:
      return MidnightJsNetworkId.Undeployed;
  }
}

/**
 * Maps from the Minight JS enum NetworkId to the ZSwap enum NetworkId
 * @param id the midnight-js-network-id NetworkId
 * @returns the corresponding zswap NetworkId
 */
function midnightJsNetworkIdToZSwapId(id: MidnightJsNetworkId): ZSwapNetworkId {
  switch (id) {
    case MidnightJsNetworkId.MainNet:
      return ZSwapNetworkId.MainNet;
    case MidnightJsNetworkId.DevNet:
      return ZSwapNetworkId.DevNet;
    case MidnightJsNetworkId.TestNet:
      return ZSwapNetworkId.TestNet;
    case MidnightJsNetworkId.Undeployed:
    default:
      return ZSwapNetworkId.Undeployed;
  }
}

/**
 * Get the remaining gap between current and target block height from the wallet state
 * @param state the wallet state to get the sync gap from
 * @returns the applyGap from the syncProgress lag, or 1,000,000 if unknown
 */
export function getWalletSyncGap(state: WalletState): bigint {
  const gap = state.syncProgress?.lag?.applyGap;
  return typeof gap === "bigint" ? (gap > 0n ? gap : 0n) : 1_000_000n;
}

/**
 * Uses the provided config to either build a new wallet from seed or restore from file if a file exists.
 * @param config Config for connecting to midnight while building the wallet
 * @param forceFromSeed if true, will build from seed even if a state file exists
 * @returns a built or restored wallet (not started)
 */
export async function buildWallet(
  config: MidnightConfig,
  forceFromSeed: boolean = false,
): Promise<Wallet> {
  const {
    serviceWalletSeedHex,
    indexerHttpUri,
    indexerWsUri,
    proofServerUri,
    substrateNodeUri,
    stateDir,
    network,
  } = config;

  if (!isHex32(serviceWalletSeedHex)) {
    throw new Error(
      "SERVICE_WALLET_SEED_HEX must be 32-byte hex (64 hex chars, no 0x).",
    );
  }

  // Whenever we build a wallet, we need to set the configured matching network ID
  const midnightJsNetworkId = networkNameToMidnightJsNetworkId(network);
  setMidnightJsNetworkId(midnightJsNetworkId);

  const stateFile = path.join(stateDir, `${network}-wallet-state.json`);

  let wallet: Wallet;
  if ((await fileExists(stateFile)) && !forceFromSeed) {
    const serialized = await readFile(stateFile);
    console.log(`Restoring wallet from state file: ${stateFile}`);
    // restore(seed, serializedState)
    wallet = await WalletBuilder.restore(
      indexerHttpUri,
      indexerWsUri,
      proofServerUri,
      substrateNodeUri,
      serviceWalletSeedHex,
      serialized,
      "info",
      false,
    );
  } else {
    wallet = await WalletBuilder.build(
      indexerHttpUri,
      indexerWsUri,
      proofServerUri,
      substrateNodeUri,
      serviceWalletSeedHex,
      midnightJsNetworkIdToZSwapId(midnightJsNetworkId),
      "info",
      false,
    );
  }

  return wallet;
}

/**
 * Then gets the current wallet state without waiting for sync
 * @param wallet the started wallet to get the state from
 * @returns The unsynced wallet state
 */
export async function getWalletStateUnsynced(
  wallet: Wallet,
): Promise<WalletState> {
  return firstValueFrom(wallet.state());
}

/**
 * Waits for the wallet to sync to within a certain number of blocks of the latest known block.
 * @param wallet the started wallet instance to wait for sync
 * @param options options for controlling sync behavior
 * @returns The wallet state once synced
 */
export async function getWalletState(
  wallet: Wallet,
  options?: {
    maxBehind?: bigint; // default 0n (fully synced)
    timeoutMs?: number; // default 3 min
    throttleMs?: number; // progress throttle (default 2s)
    minConsecutive?: number; // require N consecutive ok samples (default 2)
    onProgress?: (p: { scanned: bigint; gap: bigint }) => void;
  },
): Promise<WalletState> {
  const maxBehind = options?.maxBehind ?? 0n;
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const throttleMs = options?.throttleMs ?? 2_000;
  const minConsecutive = Math.max(1, options?.minConsecutive ?? 2);

  // One shared, replayed source for both waiting & reading
  const src$ = wallet
    .state()
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  // Optional progress logging (throttled), does not affect gating
  const progressSub = src$
    .pipe(
      throttleTime(throttleMs, undefined, { leading: true, trailing: true }),
      tap((s) => {
        if (!options?.onProgress) return;
        const scanned =
          typeof s.syncProgress?.synced === "bigint"
            ? s.syncProgress.synced
            : 0n;
        const gap = getWalletSyncGap(s);
        options.onProgress({ scanned, gap });
      }),
    )
    .subscribe();

  try {
    type Gate = { state: WalletState; ok: boolean };
    // Gate: wait until within threshold (unthrottled)
    const gate$ = src$.pipe(
      map<WalletState, Gate>((state) => ({
        state,
        ok: getWalletSyncGap(state) <= maxBehind,
      })),
      bufferCount(minConsecutive, 1),
      filter(
        (buffer) =>
          buffer.length === minConsecutive && buffer.every((g) => g.ok),
      ),
      map((buffer) => buffer[buffer.length - 1]!.state),
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
  wallet: Wallet,
  options?: {
    assetId?: string; // defaults to nativeToken()
    maxBehind?: bigint; // how close to "synced" you require (default 0n)
    timeoutMs?: number; // default 120s
    onProgress?: (info: { scanned: bigint; remaining: bigint }) => void;
  },
): Promise<bigint> {
  const assetId = options?.assetId ?? nativeToken();
  const maxBehind = options?.maxBehind ?? 0n;
  const timeoutMs = options?.timeoutMs ?? 120_000;

  const state = await getWalletState(wallet, {
    maxBehind,
    timeoutMs,
  });

  return state.balances?.[assetId] ?? 0n;
}

/**
 * Save the wallet state to disk
 * @param network network the wallet state is for
 * @param stateDir directory to save the wallet state in
 * @param wallet the started wallet instance to save state from
 */
export async function saveWallet(
  network: NetworkName,
  stateDir: string,
  wallet: Wallet,
) {
  const stateFile = path.join(stateDir, `${network}-wallet-state.json`);
  const state = await wallet.serializeState();
  await writeFile(stateFile, state);
}

/**
 * Utility wrapper that starts a wallet, invokes a function, and then closes the wallet.
 * @param config Config for building the wallet
 * @param fn function to invoke using the started wallet
 * @returns the result of the function invocation
 */
export async function withWallet<T>(
  config: MidnightConfig,
  fn: (wallet: Wallet) => Promise<T>,
): Promise<T> {
  const wallet = await buildWallet(config);
  try {
    wallet.start();
    return await fn(wallet);
  } finally {
    await wallet.close();
  }
}
