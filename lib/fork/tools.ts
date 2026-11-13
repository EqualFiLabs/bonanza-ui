import { encodeFunctionData, erc20Abi, parseAbi, parseEther, type Address, type Hex } from "viem";

import { forkDetails, publicClient } from "@/lib/chain/client";
import { lotteryAbi } from "@/lib/contracts/generated/lottery";

// Development-fork controls. Each one is a real Anvil call or a real governance transaction, so the
// app sees the same state a live deployment would produce.

let rejectNextRequest = false;
const rejectionListeners = new Set<() => void>();

export function setRejectNextRequest(value: boolean): void {
  rejectNextRequest = value;
  rejectionListeners.forEach((notify) => notify());
}

export function isRejectingNextRequest(): boolean {
  return rejectNextRequest;
}

export function subscribeToRejection(listener: () => void): () => void {
  rejectionListeners.add(listener);
  return () => rejectionListeners.delete(listener);
}

export function consumeRejection(): boolean {
  const rejected = rejectNextRequest;
  setRejectNextRequest(false);
  return rejected;
}

function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  return publicClient.request({ method: method as never, params: params as never });
}

async function sendAs(from: Address, to: Address, data: Hex, value = 0n): Promise<void> {
  const hash = (await rpc("eth_sendTransaction", [
    { from, to, data, value: `0x${value.toString(16)}` },
  ])) as Hex;
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The fork transaction reverted.");
}

export async function advanceChainTo(timestamp: bigint): Promise<void> {
  const { timestamp: current } = await publicClient.getBlock();
  if (timestamp > current) await rpc("evm_increaseTime", [Number(timestamp - current)]);
  await rpc("evm_mine");
}

export async function advanceChainBy(seconds: number): Promise<void> {
  await rpc("evm_increaseTime", [seconds]);
  await rpc("evm_mine");
}

export async function setProtocolPaused(lottery: Address, paused: boolean): Promise<void> {
  await sendAs(
    forkDetails!.authority,
    lottery,
    encodeFunctionData({ abi: lotteryAbi, functionName: "setPaused", args: [paused] })
  );
}

export async function setConversions(
  lottery: Address,
  wrap: boolean,
  unwrap: boolean,
  cap: bigint
): Promise<void> {
  await sendAs(
    forkDetails!.authority,
    lottery,
    encodeFunctionData({
      abi: lotteryAbi,
      functionName: "setBonanzaConversions",
      args: [wrap, unwrap, cap],
    })
  );
}

const wethAbi = parseAbi(["function deposit() payable"]);

/** Funds any wallet, including a Privy embedded wallet whose key Anvil doesn't hold. */
export async function fundWallet(wallet: Address): Promise<void> {
  const { staticsHolder, staticsToken, weth } = forkDetails!;
  await rpc("anvil_setBalance", [wallet, `0x${parseEther("100").toString(16)}`]);
  await rpc("anvil_impersonateAccount", [staticsHolder]);
  await sendAs(
    staticsHolder,
    staticsToken,
    encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [wallet, parseEther("20000")],
    })
  );
  await rpc("anvil_impersonateAccount", [wallet]);
  await sendAs(
    wallet,
    weth,
    encodeFunctionData({ abi: wethAbi, functionName: "deposit" }),
    parseEther("20")
  );
  await rpc("anvil_stopImpersonatingAccount", [wallet]);
}
