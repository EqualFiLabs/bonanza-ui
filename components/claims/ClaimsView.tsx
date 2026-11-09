"use client";

import Link from "next/link";
import { useState } from "react";
import { getAddress, isAddress, type Address } from "viem";

import { TxButton } from "@/components/shell/TxButton";
import { useWalletGate } from "@/components/shell/WalletGate";
import { formatToken, shortAddress } from "@/lib/protocol/format";
import { useProtocol } from "@/providers/protocol-context";
import { useTx } from "@/providers/tx-context";

import { useClaims, type Claim } from "./useClaims";

function PageHead() {
  return (
    <div className="pagehead">
      <h1 className="disp">Claims</h1>
      <p>Nothing here expires, and one failed claim never blocks another.</p>
    </div>
  );
}

function checkReceiver(text: string): { address: Address | null; reason: string } {
  const value = text.trim();
  if (!value) return { address: null, reason: "" };
  if (isAddress(value, { strict: false })) return { address: getAddress(value), reason: "" };
  if (/\.eth$/i.test(value)) {
    return {
      address: null,
      reason: "ENS names aren't resolved here yet. Paste the full 0x address.",
    };
  }
  return { address: null, reason: "Enter a full 0x address." };
}

function ClaimRow({ claim, owner }: { claim: Claim; owner: Address }) {
  const { run } = useTx();
  const [editing, setEditing] = useState(false);
  const [receiverText, setReceiverText] = useState("");
  const { address: chosen, reason } = checkReceiver(editing ? receiverText : "");
  const receiver = chosen ?? owner;
  const invalid = editing && receiverText.trim() !== "" && !chosen;

  const claimNow = () =>
    run(claim.key, async () => claim.call(receiver), {
      action: `Claim ${formatToken(claim.amount, claim.token)}`,
      pending: "Claiming…",
      success: `Claimed ${formatToken(claim.amount, claim.token)}`,
    });

  return (
    <div className="claim">
      <div>
        <b>{claim.kind}</b>
        <span className="sub">
          {claim.source} · to <span className="mono">{shortAddress(receiver)}</span> ·{" "}
          <button
            type="button"
            className="linkish"
            onClick={() => {
              setEditing((value) => !value);
              setReceiverText("");
            }}
          >
            {editing ? "Keep my wallet" : "Send elsewhere"}
          </button>
        </span>
      </div>
      <div className="amt">{formatToken(claim.amount, claim.token)}</div>
      <div>
        <TxButton
          txKey={claim.key}
          tone="win"
          small
          disabled={invalid}
          onClick={() => void claimNow()}
        >
          Claim
        </TxButton>
      </div>
      {editing ? (
        <div className="more">
          <label className="field-label">
            Receiver
            <input
              className="input mono"
              value={receiverText}
              placeholder="0x…"
              autoComplete="off"
              onChange={(event) => setReceiverText(event.target.value)}
            />
          </label>
          {reason ? (
            <p className="err" role="alert">
              {reason}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function ClaimsView() {
  const { account, accountLoading } = useProtocol();
  const { busy } = useTx();
  const gate = useWalletGate();
  const claims = useClaims();
  // While a claim runs, the list holds still. Otherwise the regular poll can remove a paid row
  // before its transaction reports back.
  const [shown, setShown] = useState(claims);
  const claiming = shown.some((claim) => busy[claim.key]);
  if (!claiming && shown !== claims) setShown(claims);
  const rows = claiming ? shown : claims;

  if (gate) {
    return (
      <>
        <PageHead />
        <div className="empty">
          Connect a wallet to see what you can claim.
          {gate}
        </div>
      </>
    );
  }
  if (accountLoading || !account) {
    return (
      <>
        <PageHead />
        <div className="empty">Reading your claims…</div>
      </>
    );
  }
  if (rows.length === 0) {
    return (
      <>
        <PageHead />
        <div className="empty">
          Nothing to claim right now.
          <Link className="btn" href="/">
            Browse rounds
          </Link>
        </div>
      </>
    );
  }
  return (
    <>
      <PageHead />
      <div className="tablewrap">
        {rows.map((claim) => (
          <ClaimRow key={claim.key} claim={claim} owner={account.owner} />
        ))}
      </div>
    </>
  );
}
