"use client";

import { useOptionalProtocol } from "@/providers/protocol-context";
import { useWalletState } from "@/providers/wallet-context";

export function Notices() {
  const state = useOptionalProtocol();
  const wallet = useWalletState();
  const wrongChain = wallet.status === "ready" && !wallet.isTargetChain;
  return (
    <>
      {wrongChain ? (
        <section className="notice" aria-label="Notice">
          <div>Your wallet is on another network. Rounds run on {wallet.networkName}.</div>
        </section>
      ) : null}
      {state?.protocol.paused ? (
        <section className="notice" aria-label="Notice">
          <div>
            <span>
              <b>New exposure is paused.</b> Tickets, staking and Operator registration are stopped.
              Draws, claims, unstaking and withdrawals still work.
            </span>
          </div>
        </section>
      ) : null}
    </>
  );
}
