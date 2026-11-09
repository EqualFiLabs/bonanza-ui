import { spawn } from "node:child_process";

import { forkRpcUrl, readDeployment, root } from "./shared.mjs";

const deployment = readDeployment();
const port = process.env.PORT ?? "3000";
// BONANZA_FORK_WALLET=privy keeps real Privy login on the fork. The default signs with the
// fork's unlocked test wallet, which needs no sign-in.
const forkWallet = process.env.BONANZA_FORK_WALLET !== "privy";

const server = spawn("npx", ["next", "dev", "--hostname", "localhost", "--port", port], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NEXT_PUBLIC_APP_ENV: "development",
    NEXT_PUBLIC_APP_NETWORK: "anvil",
    NEXT_PUBLIC_ANVIL_CHAIN_ID: String(deployment.chainId),
    NEXT_PUBLIC_ANVIL_RPC_URL: forkRpcUrl,
    NEXT_PUBLIC_BONANZA_LOCAL_DEPLOYMENT: JSON.stringify(deployment),
    NEXT_PUBLIC_BONANZA_FORK_WALLET: forkWallet ? "1" : "",
  },
});
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
server.on("exit", (code) => process.exit(code ?? 0));
