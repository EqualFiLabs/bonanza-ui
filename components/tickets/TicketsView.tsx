"use client";

import Link from "next/link";

import { useWalletGate } from "@/components/shell/WalletGate";
import { percent, ticketRanges, ticketTotal } from "@/lib/protocol/format";
import { phaseLabel, roundPhase, tokenOf } from "@/lib/protocol/rounds";
import { useProtocol } from "@/providers/protocol-context";
import { useWalletState } from "@/providers/wallet-context";

function PageHead() {
  return (
    <div className="pagehead">
      <h1 className="disp">My tickets</h1>
      <p>Tickets stay in your wallet. Odds are live until sales close.</p>
    </div>
  );
}

export function TicketsView() {
  const { protocol, account, accountLoading, now } = useProtocol();
  const { address } = useWalletState();
  const gate = useWalletGate();

  if (gate) {
    return (
      <>
        <PageHead />
        <div className="empty">
          Connect a wallet to see your tickets.
          {gate}
        </div>
      </>
    );
  }
  if (accountLoading || !account) {
    return (
      <>
        <PageHead />
        <div className="empty">Reading your tickets…</div>
      </>
    );
  }

  const held = [...protocol.rounds, ...account.olderRounds]
    .filter((round) => account.tickets[round.id.toString()])
    .sort((left, right) => Number(right.id - left.id));

  if (held.length === 0) {
    return (
      <>
        <PageHead />
        <div className="empty">
          No tickets yet.
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
        {held.map((round) => {
          const ranges = account.tickets[round.id.toString()];
          const phase = roundPhase(round, now);
          const won = phase === "settled" && round.winner === address;
          const token = tokenOf(protocol, round.config.paymentToken);
          return (
            <div className="trow" key={round.id.toString()}>
              <div>
                <b>Round {round.id.toString()}</b>
                <span className="sub">{token.symbol}</span>
              </div>
              <div className="mono hide-sm ticket-list">{ticketRanges(ranges)}</div>
              <div className="mono hide-sm">
                {percent(BigInt(ticketTotal(ranges)), BigInt(round.soldTickets))}
              </div>
              <div className="hide-sm">
                {won ? (
                  <span className="tag open">Won</span>
                ) : (
                  <span className={`tag ${phase}`}>
                    {phase === "settled" ? "Not this time" : phaseLabel(phase, round)}
                  </span>
                )}
              </div>
              <Link className="btn small" href={`/?round=${round.id}`}>
                Open
              </Link>
            </div>
          );
        })}
      </div>
    </>
  );
}
