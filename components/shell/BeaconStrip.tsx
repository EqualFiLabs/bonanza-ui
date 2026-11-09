"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchLatestBeacon } from "@/lib/chain/drand";
import { groupDigits } from "@/lib/protocol/format";

const BEACON_PERIOD_MS = 3_000;

export function BeaconStrip() {
  const { data, isError } = useQuery({
    queryKey: ["beacon"],
    refetchInterval: BEACON_PERIOD_MS,
    queryFn: ({ signal }) => fetchLatestBeacon(signal),
  });
  return (
    <section className="strip" aria-label="Live drand beacon">
      <div>
        <i className="pulse" key={data?.round.toString()} />
        <span>drand quicknet</span>
        {data ? (
          <>
            <span>
              round <b>{groupDigits(data.round)}</b>
            </span>
            <span className="hash">0x{data.randomness}</span>
          </>
        ) : (
          <span>{isError ? "feed unavailable" : "listening…"}</span>
        )}
      </div>
    </section>
  );
}
