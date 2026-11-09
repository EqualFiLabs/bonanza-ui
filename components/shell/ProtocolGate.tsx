"use client";

import { deployment, walletEnvironment } from "@/lib/chain/client";
import { useOptionalProtocol, useProtocolStatus } from "@/providers/protocol-context";

/** Every page body needs chain data, so its three missing states are handled in one place. */
export function ProtocolGate({ children }: { children: React.ReactNode }) {
  const state = useOptionalProtocol();
  const { failed } = useProtocolStatus();
  if (!deployment) {
    return (
      <div className="empty notlive">
        <h1 className="disp">Not live yet</h1>
        <p>Bonanza isn&apos;t deployed on {walletEnvironment.defaultChain.name} yet.</p>
      </div>
    );
  }
  if (state) return children;
  if (failed) {
    return (
      <div className="empty" role="alert">
        Can&apos;t reach {walletEnvironment.defaultChain.name} right now. Retrying…
      </div>
    );
  }
  return <div className="empty">Tuning in…</div>;
}
