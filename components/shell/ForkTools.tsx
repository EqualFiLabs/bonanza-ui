"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState, useSyncExternalStore } from "react";
import { parseEther } from "viem";

import { deployment, forkDetails } from "@/lib/chain/client";
import {
  advanceChainBy,
  advanceChainTo,
  fundWallet,
  isRejectingNextRequest,
  setConversions,
  setProtocolPaused,
  setRejectNextRequest,
  subscribeToRejection,
} from "@/lib/fork/tools";
import { useOptionalProtocol } from "@/providers/protocol-context";
import { useToast } from "@/providers/toast-context";
import { useWalletState } from "@/providers/wallet-context";

const WRAP_CAP = parseEther("50000");

/** Real governance calls and clock moves against the local fork. Never rendered elsewhere. */
export function ForkTools() {
  const state = useOptionalProtocol();
  const wallet = useWalletState();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [working, setWorking] = useState(false);
  const rejecting = useSyncExternalStore(subscribeToRejection, isRejectingNextRequest, () => false);

  if (!forkDetails || !state) return null;
  const { protocol, listings } = state;
  const { wrapEnabled, unwrapEnabled, wrapCap } = protocol.reserve;
  const lottery = deployment!.lottery;
  // A round already waiting on its beacon comes first, so a skip can't run out an open round.
  const nextDraw = (
    listings.find((listing) => listing.phase === "waiting") ??
    listings.find((listing) => listing.phase === "open")
  )?.round;

  const act = async (message: string, operation: () => Promise<void>) => {
    setWorking(true);
    try {
      await operation();
      await queryClient.refetchQueries();
      toast(message);
    } catch (error) {
      toast(error instanceof Error ? error.message.split("\n")[0] : "The fork call failed.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <aside aria-label="Fork tools">
      <details className="tools">
        <summary>Fork</summary>
        <div className="body">
          {nextDraw ? (
            <button
              type="button"
              className="btn"
              disabled={working}
              onClick={() =>
                void act(`Round ${nextDraw.id} is ready to draw`, () =>
                  advanceChainTo(nextDraw.beaconAt + 1n)
                )
              }
            >
              Skip round {nextDraw.id.toString()} to its draw
            </button>
          ) : null}
          <button
            type="button"
            className="btn"
            disabled={working}
            onClick={() => void act("Moved 24 hours forward", () => advanceChainBy(86_400))}
          >
            Skip 24 hours
          </button>
          {wallet.address ? (
            <button
              type="button"
              className="btn"
              disabled={working}
              onClick={() => void act("Wallet funded", () => fundWallet(wallet.address!))}
            >
              Fund this wallet
            </button>
          ) : null}
          <label>
            <input
              type="checkbox"
              checked={rejecting}
              onChange={(event) => setRejectNextRequest(event.target.checked)}
            />
            <span>Reject next wallet request</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={protocol.paused}
              disabled={working}
              onChange={(event) =>
                void act(event.target.checked ? "Protocol paused" : "Protocol unpaused", () =>
                  setProtocolPaused(lottery, event.target.checked)
                )
              }
            />
            <span>Pause the protocol</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={unwrapEnabled}
              disabled={working}
              onChange={(event) =>
                void act("Conversions updated", () =>
                  setConversions(lottery, wrapEnabled, event.target.checked, wrapCap)
                )
              }
            />
            <span>Open unwrap</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={wrapEnabled}
              disabled={working}
              onChange={(event) =>
                void act("Conversions updated", () =>
                  setConversions(lottery, event.target.checked, unwrapEnabled, WRAP_CAP)
                )
              }
            />
            <span>Open public wrap</span>
          </label>
          <p>Real calls against the local fork.</p>
        </div>
      </details>
    </aside>
  );
}
