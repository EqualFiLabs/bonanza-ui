import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { verifyLocalForkWalletProvider } from "@/lib/wallet/local-fork";

const RPC = "http://127.0.0.1:8860";
const FORK_HASH = `0x${"a".repeat(64)}`;
const MAINNET_HASH = `0x${"b".repeat(64)}`;

let forkClient = "anvil/v1.8.2";

// Answers as the local fork's own RPC would.
function forkRpc(method: string): unknown {
  if (method === "web3_clientVersion") return forkClient;
  if (method === "eth_getBlockByNumber") {
    return { number: "0x64", hash: FORK_HASH, timestamp: "0x1", transactions: [] };
  }
  throw new Error(`Unexpected fork call ${method}`);
}

beforeEach(() => {
  forkClient = "anvil/v1.8.2";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: { body: string }) => {
      const { id, method } = JSON.parse(init.body) as { id: number; method: string };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id, result: forkRpc(method) }), {
        headers: { "content-type": "application/json" },
      });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Answers as MetaMask does: its own client version, and blocks from whichever RPC it uses. */
function wallet({ chainId = "0x1237", blockHash = FORK_HASH } = {}) {
  return {
    request: vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
      if (method === "eth_chainId") return chainId;
      if (method === "web3_clientVersion") return "MetaMask/v12.23.0";
      if (method === "eth_getBlockByNumber") {
        expect(params).toEqual(["0x64", false]);
        return { hash: blockHash };
      }
      throw new Error(`Unexpected wallet call ${method}`);
    }),
  };
}

describe("verifyLocalForkWalletProvider", () => {
  it("accepts a wallet that names itself but reads the fork's blocks", async () => {
    await expect(verifyLocalForkWalletProvider(wallet(), RPC)).resolves.toBeUndefined();
  });

  it("refuses a wallet whose RPC is still mainnet", async () => {
    await expect(
      verifyLocalForkWalletProvider(wallet({ blockHash: MAINNET_HASH }), RPC)
    ).rejects.toThrow("Point your wallet's Robinhood RPC at the local Anvil fork");
  });

  it("refuses a wallet on another chain", async () => {
    await expect(verifyLocalForkWalletProvider(wallet({ chainId: "0x1" }), RPC)).rejects.toThrow(
      "not connected to the local fork"
    );
  });

  it("refuses when the configured fork RPC isn't Anvil", async () => {
    forkClient = "Geth/v1.14.0";
    await expect(verifyLocalForkWalletProvider(wallet(), RPC)).rejects.toThrow(
      "isn't an Anvil node"
    );
  });
});
