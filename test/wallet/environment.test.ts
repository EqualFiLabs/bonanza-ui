import { describe, expect, it } from "vitest";

import { resolveDeployment, resolveForkDetails } from "@/deployments/manifests";
import { readWalletEnvironment } from "@/lib/wallet-config";

const manifest = JSON.stringify({
  chainId: 4_663,
  lottery: "0x1111111111111111111111111111111111111111",
  startBlock: "12",
  authority: "0x2222222222222222222222222222222222222222",
  staticsToken: "0x3333333333333333333333333333333333333333",
  weth: "0x4444444444444444444444444444444444444444",
  staticsHolder: "0x5555555555555555555555555555555555555555",
  operatorId: "3",
  actors: { dave: "0x6666666666666666666666666666666666666666" },
});

describe("readWalletEnvironment", () => {
  it("defaults to the testnet", () => {
    const environment = readWalletEnvironment({ NEXT_PUBLIC_APP_ENV: "development" });
    expect(environment.defaultChain.id).toBe(46_630);
  });

  it("refuses a local chain outside development", () => {
    expect(() =>
      readWalletEnvironment({
        NEXT_PUBLIC_APP_ENV: "production",
        NEXT_PUBLIC_APP_NETWORK: "anvil",
        NEXT_PUBLIC_PRIVY_APP_ID: "app",
      })
    ).toThrow(/development/);
  });

  it("requires a Privy app outside development", () => {
    expect(() => readWalletEnvironment({ NEXT_PUBLIC_APP_ENV: "staging" })).toThrow(/PRIVY/);
  });

  it("keeps a mainnet-identity fork on the local RPC only", () => {
    const environment = readWalletEnvironment({
      NEXT_PUBLIC_APP_ENV: "development",
      NEXT_PUBLIC_APP_NETWORK: "anvil",
      NEXT_PUBLIC_ANVIL_CHAIN_ID: "4663",
      NEXT_PUBLIC_ANVIL_RPC_URL: "http://127.0.0.1:8860",
    });
    expect(environment.defaultChain.id).toBe(4_663);
    expect(environment.defaultChain.rpcUrls.default.http[0]).toMatch(/127\.0\.0\.1:8860/);
  });

  it("rejects a remote local RPC", () => {
    expect(() =>
      readWalletEnvironment({
        NEXT_PUBLIC_APP_ENV: "development",
        NEXT_PUBLIC_ANVIL_RPC_URL: "https://example.com",
      })
    ).toThrow(/loopback/);
  });
});

describe("deployment resolution", () => {
  it("has no public deployment yet, so public networks show not live", () => {
    expect(resolveDeployment(4_663, "production", undefined)).toBeNull();
    expect(resolveDeployment(46_630, "staging", undefined)).toBeNull();
  });

  it("uses a local manifest in development on the matching chain", () => {
    expect(resolveDeployment(4_663, "development", manifest)?.startBlock).toBe(12n);
    expect(resolveDeployment(46_630, "development", manifest)).toBeNull();
  });

  it("ignores a local manifest outside development", () => {
    expect(resolveDeployment(4_663, "production", manifest)).toBeNull();
    expect(resolveForkDetails("staging", manifest)).toBeNull();
    expect(resolveForkDetails("development", manifest)?.operatorId).toBe(3n);
  });
});
