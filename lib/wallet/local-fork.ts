import {
  createPublicClient,
  http,
  numberToHex,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { ROBINHOOD_READ_METHODS } from "@/lib/server/robinhood-rpc-methods";

type RpcRequest = { method: string; params?: unknown[] };
type WalletProvider = { request: (request: RpcRequest) => Promise<unknown> };

const FORK_CHAIN_ID = 4_663;

const forkClient = (rpcUrl: string) =>
  createPublicClient({ transport: http(rpcUrl, { retryCount: 0 }) });

/** The configured fork RPC must be Anvil itself. Asked directly, a node names its own client. */
async function verifyForkEndpoint(client: PublicClient): Promise<void> {
  const version = await client.request({ method: "web3_clientVersion" });
  if (!/^anvil\b/i.test(version)) throw new Error("The configured fork RPC isn't an Anvil node.");
}

/**
 * Mainnet and its fork share a chain ID, and wallets such as MetaMask answer web3_clientVersion
 * with their own version. So the wallet is asked for a block only this fork made: its hash matches
 * only if the wallet's RPC is the fork, and a wallet still on mainnet can't sign local writes.
 */
export async function verifyLocalForkWalletProvider(
  provider: unknown,
  rpcUrl: string
): Promise<void> {
  const request = (
    provider as {
      request: (request: { method: string; params?: readonly unknown[] }) => Promise<unknown>;
    }
  ).request.bind(provider);
  const chainId = await request({ method: "eth_chainId" });
  if (Number(BigInt(chainId as Hex)) !== FORK_CHAIN_ID) {
    throw new Error("The wallet provider is not connected to the local fork.");
  }
  const fork = forkClient(rpcUrl);
  await verifyForkEndpoint(fork);
  const block = await fork.getBlock();
  const seen = (await request({
    method: "eth_getBlockByNumber",
    params: [numberToHex(block.number), false],
  })) as { hash?: string } | null;
  if (seen?.hash?.toLowerCase() !== block.hash.toLowerCase()) {
    throw new Error("Point your wallet's Robinhood RPC at the local Anvil fork before signing.");
  }
}

export async function localForkTransactionParameters(
  wallet: Address,
  rpcUrl: string
): Promise<{ nonce: number; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const client = forkClient(rpcUrl);
  await verifyForkEndpoint(client);
  // Fork and mainnet share a chain ID, but not their nonce history or fee market. Supply all three
  // fields so wallet defaults cannot mix either chain's values.
  const [nonce, gasPrice, block] = await Promise.all([
    client.getTransactionCount({ address: wallet, blockTag: "pending" }),
    client.getGasPrice(),
    client.getBlock(),
  ]);
  const maxPriorityFeePerGas = gasPrice / 4n > 0n ? gasPrice / 4n : 1n;
  const base = block.baseFeePerGas ?? gasPrice;
  const bufferedBaseFee = base * 2n + maxPriorityFeePerGas;
  const maxFeePerGas = gasPrice * 2n > bufferedBaseFee ? gasPrice * 2n : bufferedBaseFee;
  return { nonce, maxFeePerGas, maxPriorityFeePerGas };
}

export function localForkWalletProvider<Provider extends WalletProvider>(
  provider: Provider,
  rpcUrl: string
): Provider {
  const request = provider.request.bind(provider);
  const client = forkClient(rpcUrl);
  const localRequest = async (input: RpcRequest) => {
    // Reads use the configured fork without wallet endpoint checks. Account discovery and signing
    // stay with the connected wallet.
    if (ROBINHOOD_READ_METHODS.has(input.method)) {
      return client.request(input as never);
    }
    if (/^(eth_send|eth_sign|personal_sign$|wallet_sendCalls$)/.test(input.method)) {
      await verifyLocalForkWalletProvider(provider, rpcUrl);
    }
    return request(input);
  };
  return new Proxy(provider, {
    get(target, key) {
      if (key === "request") return localRequest;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
