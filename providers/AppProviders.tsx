"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { usesForkWallet, walletEnvironment } from "@/lib/chain/client";

import { ForkWalletProvider } from "./ForkWalletProvider";
import { PrivyWalletProviders } from "./PrivyWalletProviders";
import { ProtocolProvider } from "./protocol-context";
import { ToastProvider } from "./toast-context";
import { TxProvider } from "./tx-context";

function WalletProviders({ children }: { children: React.ReactNode }) {
  if (usesForkWallet) return <ForkWalletProvider>{children}</ForkWalletProvider>;
  if (walletEnvironment.configured) {
    return <PrivyWalletProviders>{children}</PrivyWalletProviders>;
  }
  return children;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2_000,
            gcTime: 10 * 60 * 1_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <WalletProviders>
          <ProtocolProvider>
            <TxProvider>{children}</TxProvider>
          </ProtocolProvider>
        </WalletProviders>
      </ToastProvider>
    </QueryClientProvider>
  );
}
