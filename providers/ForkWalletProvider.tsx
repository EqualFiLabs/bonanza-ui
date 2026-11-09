"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { Hex } from "viem";

import { forkDetails, publicClient, targetChain } from "@/lib/chain/client";
import { consumeRejection } from "@/lib/fork/tools";

import { WalletContext, type TransactionRequest, type WalletState } from "./wallet-context";

// The sign-in lasts for the tab's session, so a reload stays connected the way Privy does.
const SIGNED_IN_KEY = "bonanza:fork-wallet";
const listeners = new Set<() => void>();
let signedIn: boolean | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function isSignedIn(): boolean {
  if (signedIn === null) {
    try {
      signedIn = sessionStorage.getItem(SIGNED_IN_KEY) === "1";
    } catch {
      signedIn = false;
    }
  }
  return signedIn;
}

function setSignedIn(value: boolean): void {
  signedIn = value;
  try {
    if (value) sessionStorage.setItem(SIGNED_IN_KEY, "1");
    else sessionStorage.removeItem(SIGNED_IN_KEY);
  } catch {
    // Without storage the sign-in still holds until the next reload.
  }
  listeners.forEach((notify) => notify());
}

/** Signs with the fork's unlocked test account. Only reachable on a development fork. */
export function ForkWalletProvider({ children }: { children: React.ReactNode }) {
  const address = useSyncExternalStore(subscribe, isSignedIn, () => false)
    ? forkDetails!.testWallet
    : null;

  const sendTransaction = useCallback(async (request: TransactionRequest): Promise<Hex> => {
    if (consumeRejection()) {
      throw Object.assign(new Error("User rejected the request."), { code: 4001 });
    }
    return publicClient.request({
      method: "eth_sendTransaction" as never,
      params: [
        {
          from: request.wallet,
          to: request.to,
          data: request.data,
          value: request.value ? `0x${request.value.toString(16)}` : undefined,
        },
      ] as never,
    }) as Promise<Hex>;
  }, []);

  const value = useMemo<WalletState>(
    () => ({
      status: address ? "ready" : "signed-out",
      address,
      walletKind: address ? "fork" : null,
      networkName: targetChain.name,
      isTargetChain: true,
      error: null,
      busyAction: null,
      login: () => setSignedIn(true),
      logout: () => setSignedIn(false),
      createWallet: async () => undefined,
      switchNetwork: async () => undefined,
      sendTransaction,
    }),
    [address, sendTransaction]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
