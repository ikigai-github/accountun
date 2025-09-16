import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG, networkNameToId } from "./config"; // or wherever you export it
import { WalletBuilder } from "@midnight-ntwrk/wallet";
import { NetworkId } from "@midnight-ntwrk/zswap";
import { isHex32 } from "@accountun/common";

async function fileExists(path: string) {
  const file = Bun.file(path);

  if (await file.exists()) {
    return true;
  } else {
    return false;
  }
}

async function writeFile(filePath: string, data: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.tmp.${path.basename(filePath)}.${Date.now()}`);
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, filePath);
}

export type ServiceWallet = Awaited<ReturnType<typeof WalletBuilder.build>>;

export async function startServiceWallet(): Promise<ServiceWallet> {
  const {
    WALLET_STATE_PATH,
    SUBSTRATE_NODE_URI,
    INDEXER_HTTP_URI,
    INDEXER_WS_URI,
    PROOF_SERVER_URI,
    SERVICE_WALLET_SEED_HEX,
    NETWORK,
  } = CONFIG;

  if (!isHex32(SERVICE_WALLET_SEED_HEX)) {
    throw new Error(
      "SERVICE_WALLET_SEED_HEX must be 32-byte hex (64 hex chars, no 0x).",
    );
  }

  if (await fileExists(WALLET_STATE_PATH)) {
    const serialized = await fs.readFile(WALLET_STATE_PATH, "utf8");
    // restore(seed, serializedState)
    const wallet = await WalletBuilder.restore(
      INDEXER_HTTP_URI,
      INDEXER_WS_URI,
      PROOF_SERVER_URI,
      SUBSTRATE_NODE_URI,
      SERVICE_WALLET_SEED_HEX,
      serialized,
      "info",
      false,
    );

    wallet.start();

    return wallet;
  }

  // First boot: build from seed, then persist serialized state
  const wallet = await WalletBuilder.build(
    INDEXER_HTTP_URI,
    INDEXER_WS_URI,
    PROOF_SERVER_URI,
    SUBSTRATE_NODE_URI,
    SERVICE_WALLET_SEED_HEX,
    networkNameToId(NETWORK),
    "info",
    false,
  );
  if (typeof (wallet as any).start === "function")
    await (wallet as any).start();

  const state = await wallet.serializeState();
  await writeFile(WALLET_STATE_PATH, state);
  return wallet;
}

export async function saveServiceWallet(wallet: ServiceWallet) {
  const state = await wallet.serializeState();
  await writeFile(CONFIG.WALLET_STATE_PATH, state);
}
