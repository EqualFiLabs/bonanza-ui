import { createPublicClient, http } from "viem";

import { forkRpcUrl, readDeployment } from "./shared.mjs";

const deployment = readDeployment();
const client = createPublicClient({ transport: http(forkRpcUrl, { retryCount: 0 }) });
const block = await client.getBlock();
console.log({
  rpc: forkRpcUrl,
  chainId: await client.getChainId(),
  block: block.number,
  chainTime: new Date(Number(block.timestamp) * 1000).toISOString(),
  lottery: deployment.lottery,
  testWallet: deployment.actors.dave,
});
