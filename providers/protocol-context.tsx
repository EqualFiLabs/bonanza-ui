"use client";

import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";

import { useChainTime } from "@/hooks/useChainTime";
import { deployment, publicClient } from "@/lib/chain/client";
import { loadAccount, loadProtocol } from "@/lib/protocol/load";
import { buildListings, type Listing } from "@/lib/protocol/rounds";
import type { AccountSnapshot, ProtocolSnapshot } from "@/lib/protocol/types";

import { useWalletState } from "./wallet-context";

const POLL_MS = 4_000;

export const PROTOCOL_QUERY = "protocol";
export const ACCOUNT_QUERY = "account";

export type ProtocolState = Readonly<{
  protocol: ProtocolSnapshot;
  account: AccountSnapshot | null;
  accountLoading: boolean;
  listings: readonly Listing[];
  now: bigint;
}>;

const ProtocolContext = createContext<ProtocolState | null>(null);

export function useProtocol(): ProtocolState {
  const state = useContext(ProtocolContext);
  if (!state) throw new Error("useProtocol must be used below the protocol gate.");
  return state;
}

/** Null until the first snapshot, so the masthead can render before the chain answers. */
export function useOptionalProtocol(): ProtocolState | null {
  return useContext(ProtocolContext);
}

function ProtocolReady({
  protocol,
  children,
}: {
  protocol: ProtocolSnapshot;
  children: React.ReactNode;
}) {
  const { address, status } = useWalletState();
  const owner = status === "ready" ? address : null;
  const account = useQuery({
    queryKey: [ACCOUNT_QUERY, owner],
    enabled: Boolean(owner),
    refetchInterval: POLL_MS,
    queryFn: () => loadAccount(publicClient, deployment!, protocol, owner!),
  });
  const now = useChainTime(protocol.blockTimestamp, protocol.observedAtMs);
  const value = useMemo<ProtocolState>(
    () => ({
      protocol,
      account: account.data && account.data.owner === owner ? account.data : null,
      accountLoading: Boolean(owner) && account.isPending,
      listings: buildListings(protocol, now),
      now,
    }),
    [account.data, account.isPending, now, owner, protocol]
  );
  return <ProtocolContext.Provider value={value}>{children}</ProtocolContext.Provider>;
}

const protocolQuery = {
  queryKey: [PROTOCOL_QUERY],
  enabled: deployment !== null,
  refetchInterval: POLL_MS,
  queryFn: () => loadProtocol(publicClient, deployment!),
};

export function ProtocolProvider({ children }: { children: React.ReactNode }) {
  const protocol = useQuery(protocolQuery);
  if (!protocol.data) return children;
  return <ProtocolReady protocol={protocol.data}>{children}</ProtocolReady>;
}

export function useProtocolStatus(): { live: boolean; failed: boolean } {
  const protocol = useQuery(protocolQuery);
  return { live: deployment !== null, failed: protocol.isError && !protocol.data };
}
