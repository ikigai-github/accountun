import { unshieldedToken } from "@midnight-ntwrk/ledger-v7";

export type UnshieldedCoinLike = {
  utxo: { type: string; txId?: string; index?: number };
  meta?: { registeredForDustGeneration?: boolean };
};

export function isDustRegistered(coin: UnshieldedCoinLike): boolean {
  return coin.meta?.registeredForDustGeneration === true;
}

export function isDustEligibleUnshieldedNightCoin(
  coin: UnshieldedCoinLike,
  tokenRaw: string = unshieldedToken().raw,
): boolean {
  return coin.utxo.type === tokenRaw && !isDustRegistered(coin);
}
