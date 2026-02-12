import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(moduleDir, "../../../../");
loadEnv({ path: path.join(rootDir, ".env"), override: false });

function ensureDockerRunning() {
  try {
    execSync("docker info", { stdio: "ignore" });
  } catch {
    throw new Error(
      "Docker is not running. Start the Docker service before running integration tests.",
    );
  }
}

function ensureEnv(name: string) {
  if (!process.env[name]) {
    throw new Error(
      `${name} is required for integration tests. Ensure it is set in the repo .env or your shell environment.`,
    );
  }
}

ensureDockerRunning();
ensureEnv("SERVICE_WALLET_SEED_HEX");
