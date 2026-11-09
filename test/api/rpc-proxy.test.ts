// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { POST as readProxy } from "@/app/api/rpc/[chainId]/route";
import { POST as walletProxy } from "@/app/api/wallet-rpc/[chainId]/route";
import { robinhoodRpcUrl } from "@/lib/server/robinhood-rpc";

const params = (chainId: string) => ({ params: Promise.resolve({ chainId }) });
const request = (body: unknown, origin = "http://app.test") =>
  new Request("http://app.test/api/rpc/46630", {
    method: "POST",
    headers: { host: "app.test", origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("read proxy", () => {
  it("refuses other origins", async () => {
    vi.stubEnv("BONANZA_ROBINHOOD_TESTNET_RPC_URL", "http://upstream.test");
    const response = await readProxy(
      request({ method: "eth_call" }, "http://evil.test"),
      params("46630")
    );
    expect(response.status).toBe(403);
  });

  it("refuses state-changing methods", async () => {
    vi.stubEnv("BONANZA_ROBINHOOD_TESTNET_RPC_URL", "http://upstream.test");
    const response = await readProxy(
      request({ method: "eth_sendRawTransaction", params: ["0x00"] }),
      params("46630")
    );
    expect(response.status).toBe(403);
  });

  it("forwards reads without exposing the upstream", async () => {
    vi.stubEnv("BONANZA_ROBINHOOD_TESTNET_RPC_URL", "http://upstream.test/secret");
    const upstream = vi.fn(async () => new Response('{"result":"0x1"}'));
    vi.stubGlobal("fetch", upstream);
    const response = await readProxy(request({ method: "eth_chainId" }), params("46630"));
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("secret");
    expect(upstream.mock.calls).toHaveLength(1);
  });

  it("reports a missing upstream without a chain leak", async () => {
    const response = await readProxy(request({ method: "eth_chainId" }), params("1"));
    expect(response.status).toBe(503);
  });
});

describe("wallet proxy", () => {
  it("requires the application origin", async () => {
    vi.stubEnv("BONANZA_ROBINHOOD_TESTNET_WALLET_RPC_URL", "http://upstream.test");
    const bare = new Request("http://app.test/api/wallet-rpc/46630", {
      method: "POST",
      body: "{}",
    });
    expect((await walletProxy(bare, params("46630"))).status).toBe(403);
  });

  it("refuses an unsigned or malformed transaction", async () => {
    vi.stubEnv("BONANZA_ROBINHOOD_TESTNET_WALLET_RPC_URL", "http://upstream.test");
    const response = await walletProxy(
      request({ method: "eth_sendRawTransaction", params: ["0x1234"] }),
      params("46630")
    );
    expect(response.status).toBe(400);
  });
});

describe("robinhoodRpcUrl", () => {
  it("rejects an unknown chain", () => {
    expect(() => robinhoodRpcUrl(1, {})).toThrow(/Unsupported/);
  });
});
