import { createPublicClient, http, type Address, type Hex } from "viem";

import { ROBINHOOD_READ_METHODS } from "@/lib/server/robinhood-rpc-methods";

type RpcRequest = { method: string; params?: unknown[] };
type WalletProvider = { request: (request: RpcRequest) => Promise<unknown> };

const FORK_CHAIN_ID = 4_663;

export async function verifyLocalForkWalletProvider(provider: unknown): Promise<void> {
  const request = (
    provider as {
      request: (request: { method: string; params?: readonly unknown[] }) => Promise<unknown>;
    }
  ).request.bind(provider);
  const chainId = await request({ method: "eth_chainId" });
  if (Number(BigInt(chainId as Hex)) !== FORK_CHAIN_ID) {
    throw new Error("The wallet provider is not connected to the local fork.");
  }
  // Mainnet and its fork share a chain ID. Check the wallet's endpoint before local writes so an
  // external wallet still using mainnet cannot sign them.
  const client = await request({ method: "web3_clientVersion" });
  if (typeof client !== "string" || !/^anvil\b/i.test(client)) {
    throw new Error("Point your wallet's Robinhood RPC at the local Anvil fork before signing.");
  }
}

export async function localForkTransactionParameters(
  wallet: Address,
  rpcUrl: string
): Promise<{ nonce: number; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0 }) });
  await verifyLocalForkWalletProvider(client);
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
  const client = createPublicClient({ transport: http(rpcUrl, { retryCount: 0 }) });
  const localRequest = async (input: RpcRequest) => {
    // Reads use the configured fork without wallet endpoint checks. Account discovery and signing
    // stay with the connected wallet.
    if (ROBINHOOD_READ_METHODS.has(input.method)) {
      return client.request(input as never);
    }
    if (/^(eth_send|eth_sign|personal_sign$|wallet_sendCalls$)/.test(input.method)) {
      await verifyLocalForkWalletProvider(provider);
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
