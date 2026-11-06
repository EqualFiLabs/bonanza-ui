import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { createTestClient, http } from "viem";

import { baselinePath, forkRpcUrl } from "./shared.mjs";

if (!existsSync(baselinePath)) throw new Error("No fork baseline. Run npm run fork:up first.");
const { snapshot, timestamp } = JSON.parse(readFileSync(baselinePath, "utf8"));

const client = createTestClient({ mode: "anvil", transport: http(forkRpcUrl) });

// Pending transactions survive a revert, and a snapshot doesn't restore Anvil's clock offset.
await client.request({ method: "anvil_dropAllTransactions", params: [] });
const reverted = await client.request({ method: "evm_revert", params: [snapshot] });
if (!reverted) throw new Error("The fork baseline is unavailable.");
await client.request({ method: "anvil_setTime", params: [Number(timestamp)] });
await client.mine({ blocks: 1 });

// A snapshot is spent by reverting to it, so each reset records the next one.
const next = await client.snapshot();
writeFileSync(baselinePath, JSON.stringify({ snapshot: next, timestamp }));
console.log("The fork is back at its seeded state.");
