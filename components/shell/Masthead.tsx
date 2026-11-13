"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useClaims } from "@/components/claims/useClaims";
import { forkDetails } from "@/lib/chain/client";
import { shortAddress } from "@/lib/protocol/format";
import { useWalletState } from "@/providers/wallet-context";

import { Logo } from "./Logo";

const LINKS = [
  { href: "/", label: "Rounds" },
  { href: "/tickets", label: "My tickets" },
  { href: "/bonanza", label: "BONANZA" },
  { href: "/claims", label: "Claims" },
];

function WalletControl() {
  const wallet = useWalletState();
  if (wallet.status === "ready" && wallet.address) {
    return (
      <div className="wallet">
        <div className="chip">
          <i className={`dot ${wallet.isTargetChain ? "" : "off"}`} />
          <span className="mono">{shortAddress(wallet.address)}</span>
        </div>
        <button type="button" className="linkish" onClick={wallet.logout}>
          Sign out
        </button>
      </div>
    );
  }
  if (wallet.status === "unconfigured") return <div className="wallet" />;
  return (
    <div className="wallet">
      <button
        type="button"
        className="btn small primary"
        disabled={wallet.status === "loading"}
        onClick={
          wallet.status === "wallet-missing" ? () => void wallet.createWallet() : wallet.login
        }
      >
        {wallet.status === "wallet-missing" ? "Create wallet" : "Connect wallet"}
      </button>
    </div>
  );
}

export function Masthead() {
  const path = usePathname();
  const claims = useClaims();
  return (
    <header className="top">
      <Link className="brand" href="/">
        <Logo />
        <span className="disp">Bonanza</span>
        {forkDetails ? <span className="net-tag">FORK</span> : null}
      </Link>
      <nav aria-label="Main">
        {LINKS.map(({ href, label }) => (
          <Link
            className="tab"
            key={href}
            href={href}
            aria-current={path === href ? "page" : undefined}
          >
            {label}
            {href === "/claims" && claims.length > 0 ? (
              <span className="badge">{claims.length}</span>
            ) : null}
          </Link>
        ))}
      </nav>
      <WalletControl />
    </header>
  );
}
