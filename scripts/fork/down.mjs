import { existsSync, readFileSync, rmSync } from "node:fs";

import { baselinePath, deploymentPath, pidPath } from "./shared.mjs";

if (!existsSync(pidPath)) {
  console.log("No local fork is recorded.");
  process.exit(0);
}
const pid = Number(readFileSync(pidPath, "utf8"));
const command = existsSync(`/proc/${pid}/cmdline`)
  ? readFileSync(`/proc/${pid}/cmdline`, "utf8")
  : "";
// Only stop the Anvil this repository started; a reused process ID is left alone.
if (command.includes("anvil")) process.kill(pid, "SIGTERM");
rmSync(pidPath, { force: true });
rmSync(deploymentPath, { force: true });
rmSync(baselinePath, { force: true });
console.log("Stopped the local fork.");
