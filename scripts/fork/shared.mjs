import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const root = resolve(import.meta.dirname, "../..");
export const forkDirectory = resolve(root, ".local/fork");
export const deploymentPath = resolve(forkDirectory, "deployment.json");
export const pidPath = resolve(forkDirectory, "anvil.pid");
export const baselinePath = resolve(forkDirectory, "baseline.json");

export const forkPort = Number(process.env.BONANZA_FORK_PORT ?? 8860);
export const forkRpcUrl = `http://127.0.0.1:${forkPort}`;

// Pinned so runs share the Foundry fork cache and reach the same state. Every Quicknet beacon
// a local round commits to is already published, so draws use genuine signatures.
export const forkBlock = BigInt(process.env.BONANZA_FORK_BLOCK ?? 101_439_372);
export const robinhoodMainnetChainId = 4_663;

export function contractsDirectory() {
  const directory = resolve(root, process.env.BONANZA_CONTRACTS_DIR ?? "../bonanza");
  if (!existsSync(resolve(directory, "foundry.toml"))) {
    throw new Error("Set BONANZA_CONTRACTS_DIR to a checkout of EqualFiLabs/bonanza.");
  }
  return directory;
}

export function artifact(group, name) {
  const path = resolve(forkDirectory, `out-${group}`, `${name}.sol`, `${name}.json`);
  if (!existsSync(path)) throw new Error(`Missing ${group}/${name}. Run npm run fork:build first.`);
  return JSON.parse(readFileSync(path, "utf8"));
}

export function readDeployment() {
  if (!existsSync(deploymentPath)) throw new Error("No local fork. Run npm run fork:up first.");
  return JSON.parse(readFileSync(deploymentPath, "utf8"));
}
