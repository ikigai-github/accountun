import type { WalletContext } from "./types";
import type { FacadeState } from "@midnight-ntwrk/wallet-sdk-facade";
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

export type WalletState = FacadeState;

type WalletSyncCursor = {
  unshieldedAppliedId: bigint;
  unshieldedHighestTransactionId: bigint;
  shieldedAppliedIndex: bigint;
  shieldedHighestRelevantWalletIndex: bigint;
  dustAppliedIndex: bigint;
  dustHighestRelevantWalletIndex: bigint;
};

type WalletSyncAdvanceOptions = {
  baselineState?: WalletState;
  timeoutMs?: number;
  pollMs?: number;
  txId?: string;
};

type WalletStateOptions = {
  timeoutMs?: number;
  throttleMs?: number;
  minConsecutive?: number;
  onProgress?: (status: { synced: boolean }) => void;
};

function captureWalletSyncCursor(state: WalletState): WalletSyncCursor {
  return {
    unshieldedAppliedId: state.unshielded.progress.appliedId,
    unshieldedHighestTransactionId:
      state.unshielded.progress.highestTransactionId,
    shieldedAppliedIndex: state.shielded.progress.appliedIndex ?? 0n,
    shieldedHighestRelevantWalletIndex:
      state.shielded.progress.highestRelevantWalletIndex ?? 0n,
    dustAppliedIndex: state.dust.progress.appliedIndex ?? 0n,
    dustHighestRelevantWalletIndex:
      state.dust.progress.highestRelevantWalletIndex ?? 0n,
  };
}

function hasWalletSyncAdvanced(
  previous: WalletSyncCursor,
  current: WalletSyncCursor,
): boolean {
  return (
    current.unshieldedAppliedId > previous.unshieldedAppliedId ||
    current.unshieldedHighestTransactionId >
      previous.unshieldedHighestTransactionId ||
    current.shieldedAppliedIndex > previous.shieldedAppliedIndex ||
    current.shieldedHighestRelevantWalletIndex >
      previous.shieldedHighestRelevantWalletIndex ||
    current.dustAppliedIndex > previous.dustAppliedIndex ||
    current.dustHighestRelevantWalletIndex >
      previous.dustHighestRelevantWalletIndex
  );
}

function createWalletStateStream(wallet: WalletContext) {
  return wallet.wallet
    .state()
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));
}

/**
 * Returns the latest wallet state sample without waiting for sync to complete.
 */
export async function getWalletStateUnsynced(
  wallet: WalletContext,
): Promise<WalletState> {
  return firstValueFrom(wallet.wallet.state());
}

/**
 * Waits until the wallet reports synced for a stable number of consecutive samples.
 */
export async function getWalletState(
  wallet: WalletContext,
  options?: WalletStateOptions,
): Promise<WalletState> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const throttleMs = options?.throttleMs ?? 2_000;
  const minConsecutive = Math.max(1, options?.minConsecutive ?? 2);

  const stateStream = createWalletStateStream(wallet);

  const progressSubscription = stateStream
    .pipe(
      throttleTime(throttleMs, undefined, { leading: true, trailing: true }),
      tap((state: WalletState) => {
        if (!options?.onProgress) return;
        options.onProgress({ synced: state.isSynced });
      }),
    )
    .subscribe();

  try {
    type SyncGateSample = { state: WalletState; isSynced: boolean };

    const syncedState$ = stateStream.pipe(
      map<WalletState, SyncGateSample>((state) => ({
        state,
        isSynced: state.isSynced,
      })),
      bufferCount(minConsecutive, 1),
      filter(
        (samples: SyncGateSample[]) =>
          samples.length === minConsecutive && samples.every((s) => s.isSynced),
      ),
      map((samples: SyncGateSample[]) => samples[samples.length - 1]!.state),
      take(1),
    );

    const boundedSyncedState$ =
      timeoutMs > 0
        ? syncedState$.pipe(timeout({ each: timeoutMs }))
        : syncedState$;

    return await firstValueFrom(boundedSyncedState$);
  } finally {
    progressSubscription.unsubscribe();
  }
}

/**
 * Waits until wallet sync cursors move forward relative to a baseline state.
 */
export async function waitForWalletSyncAdvance(
  wallet: WalletContext,
  options?: WalletSyncAdvanceOptions,
): Promise<WalletState> {
  const timeoutMs = options?.timeoutMs ?? 180_000;
  const pollMs = options?.pollMs ?? 1_500;
  const baselineState =
    options?.baselineState ?? (await getWalletState(wallet, { timeoutMs }));
  const baselineCursor = captureWalletSyncCursor(baselineState);

  const deadline = Date.now() + timeoutMs;

  while (true) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      const txSuffix = options?.txId ? ` for tx ${options.txId}` : "";
      throw new Error(
        `Timed out waiting for wallet sync advancement${txSuffix}`,
      );
    }

    const state = await getWalletState(wallet, {
      timeoutMs: Math.max(1_000, Math.min(remainingMs, 60_000)),
    });

    if (hasWalletSyncAdvanced(baselineCursor, captureWalletSyncCursor(state))) {
      return state;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
