"use client";

import { useCallback, useMemo, useState } from "react";
import type { Address, Hex } from "viem";

import { forkDetails, publicClient, targetChain } from "@/lib/chain/client";
import { consumeRejection } from "@/lib/fork/tools";

import { WalletContext, type TransactionRequest, type WalletState } from "./wallet-context";

/** Signs with the fork's unlocked test account. Only reachable on a development fork. */
export function ForkWalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<Address | null>(null);

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
      login: () => setAddress(forkDetails!.testWallet),
      logout: () => setAddress(null),
      createWallet: async () => undefined,
      switchNetwork: async () => undefined,
      sendTransaction,
    }),
    [address, sendTransaction]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}
