import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { contractsDirectory, forkDirectory } from "./shared.mjs";

const contracts = contractsDirectory();
mkdirSync(forkDirectory, { recursive: true });

// Output and caches stay in this repository, so the contract checkout is not touched.
const builds = {
  lottery: ["build", "--skip", "test", "--skip", "script"],
  statics: ["build", "--config-path", "integration/foundry.toml"],
  router: ["build", "--root", "lib/operator-fee-router", "--skip", "test", "--skip", "script"],
};

for (const [group, command] of Object.entries(builds)) {
  console.log(`Building ${group} artifacts`);
  const result = spawnSync(
    "forge",
    [
      ...command,
      "--out",
      resolve(forkDirectory, `out-${group}`),
      "--cache-path",
      resolve(forkDirectory, `cache-${group}`),
    ],
    { cwd: contracts, stdio: ["ignore", "ignore", "inherit"] }
  );
  if (result.status !== 0) throw new Error(`The ${group} build failed.`);
}
console.log("Contract artifacts are ready.");
