import { afterEach, describe, expect, it, vi } from "vitest";

import {
  REVOKE_TIMEOUT_MS,
  signOutEverywhere,
  type DisconnectableWallet,
} from "@/lib/wallet/disconnection";

function wallet(
  walletClientType: string,
  connectorType: string,
  request: (request: { method: string }) => Promise<unknown> = async () => null
) {
  const provider = { request: vi.fn(request) };
  const entry = {
    walletClientType,
    connectorType,
    getEthereumProvider: vi.fn(async () => provider),
    disconnect: vi.fn(),
  } satisfies DisconnectableWallet;
  return { entry, provider };
}

function signOut(wallets: DisconnectableWallet[], steps: string[] = []) {
  return signOutEverywhere({
    wallets,
    disconnectConnectors: async () => {
      steps.push("connectors");
    },
    logout: async () => {
      steps.push("logout");
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("signOutEverywhere", () => {
  it("drops an injected wallet's access, then the connectors, then the session", async () => {
    const steps: string[] = [];
    const metamask = wallet("metamask", "injected", async ({ method }) => {
      steps.push(method);
      return null;
    });
    await signOut([metamask.entry], steps);
    expect(steps).toEqual(["wallet_revokePermissions", "connectors", "logout"]);
    // Privy can't disconnect an injected wallet and only warns, so it isn't asked to.
    expect(metamask.entry.disconnect).not.toHaveBeenCalled();
  });

  it("closes sessions that can be closed and leaves the embedded wallet to the logout", async () => {
    const walletConnect = wallet("rainbow", "wallet_connect_v2");
    const embedded = wallet("privy", "embedded");
    await signOut([walletConnect.entry, embedded.entry]);
    expect(walletConnect.entry.disconnect).toHaveBeenCalledOnce();
    expect(embedded.entry.getEthereumProvider).not.toHaveBeenCalled();
    expect(embedded.entry.disconnect).not.toHaveBeenCalled();
  });

  it("still signs out when a wallet ignores, rejects or throws", async () => {
    vi.useFakeTimers();
    const steps: string[] = [];
    const silent = wallet("rabby", "injected", () => new Promise(() => undefined));
    const refusing = wallet("other", "injected", async () => {
      throw new Error("Method not supported");
    });
    const placeholder = wallet("coinbase_wallet", "null");
    placeholder.entry.disconnect.mockImplementation(() => {
      throw new Error("disconnect called for an uninstalled wallet");
    });
    const done = signOut([silent.entry, refusing.entry, placeholder.entry], steps);
    await vi.advanceTimersByTimeAsync(REVOKE_TIMEOUT_MS);
    await done;
    expect(steps).toEqual(["connectors", "logout"]);
  });

  it("ends the session even if the connectors fail to disconnect", async () => {
    const logout = vi.fn(async () => undefined);
    await signOutEverywhere({
      wallets: [],
      disconnectConnectors: async () => {
        throw new Error("connector failed");
      },
      logout,
    });
    expect(logout).toHaveBeenCalledOnce();
  });
});
