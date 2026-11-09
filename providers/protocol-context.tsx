"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState } from "react";
import type { Address } from "viem";

import { useChainTime } from "@/hooks/useChainTime";
import { deployment, publicClient } from "@/lib/chain/client";
import { loadSnapshot } from "@/lib/protocol/load";
import { buildListings, type Listing } from "@/lib/protocol/rounds";
import type { AccountSnapshot, ProtocolSnapshot, Snapshot } from "@/lib/protocol/types";

import { useWalletState } from "./wallet-context";

const POLL_MS = 4_000;

export const PROTOCOL_QUERY = "protocol";

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

function useSnapshotQuery() {
  const { address, status } = useWalletState();
  const owner = status === "ready" ? address : null;
  const query = useQuery({
    queryKey: [PROTOCOL_QUERY, owner],
    enabled: deployment !== null,
    refetchInterval: POLL_MS,
    // A newly connected wallet keeps the rounds on screen while its own state loads.
    placeholderData: keepPreviousData,
    queryFn: () => loadSnapshot(publicClient, deployment!, owner),
  });
  return { owner, query };
}

function ProtocolReady({
  snapshot,
  owner,
  children,
}: {
  snapshot: Snapshot;
  owner: Address | null;
  children: React.ReactNode;
}) {
  const { protocol } = snapshot;
  const now = useChainTime(protocol.blockTimestamp, protocol.observedAtMs);
  const value = useMemo<ProtocolState>(() => {
    const account = snapshot.account?.owner === owner ? snapshot.account : null;
    return {
      protocol,
      account,
      accountLoading: owner !== null && account === null,
      listings: buildListings(protocol, now),
      now,
    };
  }, [now, owner, protocol, snapshot.account]);
  return <ProtocolContext.Provider value={value}>{children}</ProtocolContext.Provider>;
}

export function ProtocolProvider({ children }: { children: React.ReactNode }) {
  const { owner, query } = useSnapshotQuery();
  // If a new wallet's first read fails, the last good snapshot stays up while the poll retries.
  const [lastGood, setLastGood] = useState<Snapshot | null>(null);
  if (query.data && query.data !== lastGood) setLastGood(query.data);
  const snapshot = query.data ?? lastGood;
  if (!snapshot) return children;
  return (
    <ProtocolReady snapshot={snapshot} owner={owner}>
      {children}
    </ProtocolReady>
  );
}

export function useProtocolStatus(): { live: boolean; failed: boolean } {
  const { query } = useSnapshotQuery();
  return { live: deployment !== null, failed: query.isError && !query.data };
}
