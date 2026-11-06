import { execFileSync } from "node:child_process";

/** Every run starts from the seeded chain, however the last one ended. */
export default function globalSetup(): void {
  execFileSync("node", ["scripts/fork/reset.mjs"], { stdio: "inherit" });
}
