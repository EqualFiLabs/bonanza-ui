"use client";

import { useWalletState } from "@/providers/wallet-context";

/** The one action that comes before anything onchain: sign in, get a wallet, reach the network. */
export function useWalletGate(): React.ReactNode | null {
  const wallet = useWalletState();
  if (wallet.status === "unconfigured") {
    return (
      <>
        <button type="button" className="btn" disabled>
          Sign-in unavailable
        </button>
        <p className="why">Wallet sign-in isn&apos;t configured for this build.</p>
      </>
    );
  }
  if (wallet.status === "loading") {
    return (
      <button type="button" className="btn" disabled>
        Loading wallet…
      </button>
    );
  }
  if (wallet.status === "signed-out" || wallet.status === "error") {
    return (
      <>
        <button type="button" className="btn primary" onClick={wallet.login}>
          Connect wallet
        </button>
        {wallet.error ? (
          <p className="err" role="alert">
            {wallet.error}
          </p>
        ) : null}
      </>
    );
  }
  if (wallet.status === "wallet-missing") {
    return (
      <button
        type="button"
        className="btn primary"
        disabled={wallet.busyAction === "create"}
        onClick={() => void wallet.createWallet()}
      >
        Create wallet
      </button>
    );
  }
  if (!wallet.isTargetChain) {
    return (
      <>
        <button
          type="button"
          className="btn primary"
          disabled={wallet.busyAction === "switch"}
          onClick={() => void wallet.switchNetwork()}
        >
          {wallet.busyAction === "switch" ? "Switching…" : `Switch to ${wallet.networkName}`}
        </button>
        {wallet.error ? (
          <p className="err" role="alert">
            {wallet.error}
          </p>
        ) : null}
      </>
    );
  }
  return null;
}
