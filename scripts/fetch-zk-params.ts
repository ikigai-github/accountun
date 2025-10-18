#!/usr/bin/env bun
/**
 * Fetch Midnight zk params into a local cache.
 *
 * Env vars:
 * - CIRCUIT_PARAM_RANGE: space-separated list (default: "10 11 12 13 14 15 16 17")
 * - ZK_PARAMS_DIR: target directory (default: ".cache/midnight/zk-params")
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const BASE =
  "https://midnight-s3-fileshare-dev-eu-west-1.s3.eu-west-1.amazonaws.com";
const DEFAULT_RANGE = "10 11 12 13 14 15 16 17";
const DEFAULT_DIR = ".cache/midnight/zk-params";

const CIRCUIT_PARAM_RANGE = (process.env.CIRCUIT_PARAM_RANGE ?? DEFAULT_RANGE)
  .split(/\s+/)
  .filter(Boolean);

const ZK_PARAMS_DIR = process.env.ZK_PARAMS_DIR ?? DEFAULT_DIR;

const ZSWAP_VERSION_DIR = join(ZK_PARAMS_DIR, "zswap", "4");
const ZSWAP_FILES = [
  "output.bzkir",
  "output.prover",
  "output.verifier",
  "sign.bzkir",
  "sign.prover",
  "sign.verifier",
  "spend.bzkir",
  "spend.prover",
  "spend.verifier",
];

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

async function download(
  url: string,
  dest: string,
  attempts = 3,
): Promise<void> {
  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(url);
    if (res.ok) {
      const ab = await res.arrayBuffer();
      await ensureDir(dirname(dest));
      await writeFile(dest, Buffer.from(ab));
      return;
    }
    if (i === attempts) {
      throw new Error(
        `Failed ${url} -> ${dest}: ${res.status} ${res.statusText}`,
      );
    }
    // brief backoff
    await new Promise((r) => setTimeout(r, 300 * i));
  }
}

async function main() {
  console.log(`📁 Target dir: ${ZK_PARAMS_DIR}`);
  await ensureDir(ZK_PARAMS_DIR);
  await ensureDir(ZSWAP_VERSION_DIR);

  // 1) BLS Filecoin params
  console.log("📥 Downloading BLS Filecoin params...");
  for (const i of CIRCUIT_PARAM_RANGE) {
    const name = `bls_filecoin_2p${i}`;
    const url = `${BASE}/${name}`;
    const dest = join(ZK_PARAMS_DIR, name);
    process.stdout.write(`  ↳ ${name} ... `);
    await download(url, dest).then(
      () => console.log("ok"),
      (e) => {
        console.log("fail");
        throw e;
      },
    );
  }

  // 2) zswap/4 circuits
  console.log("📥 Downloading zswap/4 circuits...");
  for (const file of ZSWAP_FILES) {
    const url = `${BASE}/zswap/4/${file}`;
    const dest = join(ZSWAP_VERSION_DIR, file);
    process.stdout.write(`  ↳ ${file} ... `);
    await download(url, dest).then(
      () => console.log("ok"),
      (e) => {
        console.log("fail");
        throw e;
      },
    );
  }

  console.log("✅ All zk params downloaded.");
}

main().catch((err) => {
  console.error("✖ Error:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
