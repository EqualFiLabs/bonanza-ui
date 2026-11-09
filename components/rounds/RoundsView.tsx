"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import {
  channelLabel,
  countdown,
  formatFigure,
  formatToken,
  groupDigits,
  ticketRanges,
  ticketTotal,
} from "@/lib/protocol/format";
import {
  actualAllocation,
  phaseLabel,
  selloutAllocation,
  tokenOf,
  type Listing,
} from "@/lib/protocol/rounds";
import { RoundStatus } from "@/lib/protocol/types";
import { useProtocol } from "@/providers/protocol-context";

import { REVEAL_MS, StaticField, type Reveal } from "./StaticField";
import { TicketPanel, type DrawEvents } from "./TicketPanel";

const REVEAL_HOLD = 1.35;

function accentFor(symbol: string): string {
  if (symbol === "WETH") return "--weth";
  if (symbol === "STATICS") return "--statics";
  return "--bona";
}

function Stage({
  listing,
  reveal,
  onDraw,
}: {
  listing: Listing;
  reveal: Reveal | null;
  onDraw: DrawEvents;
}) {
  const { protocol, account, now } = useProtocol();
  const { config, rewards, round, phase } = listing;
  const token = tokenOf(protocol, config.paymentToken);
  const plate = useRef<HTMLElement>(null);
  const accent = accentFor(token.symbol);
  const sold = round?.soldTickets ?? 0;
  const mine = round && account ? (account.tickets[round.id.toString()] ?? []) : [];
  const held = ticketTotal(mine);
  const sellout = selloutAllocation(config, rewards);
  const current = round ? actualAllocation(round) : null;
  const revealing = reveal !== null && round !== null && reveal.roundId === round.id;

  const figure = current ? current.winner : sellout.winner;
  const subtitle =
    phase === "settled"
      ? "paid to the winner"
      : phase === "idle"
        ? "to the winner at sellout"
        : phase === "open"
          ? `to the winner so far · ${formatToken(sellout.winner, token)} at sellout`
          : "to the winner";

  return (
    <div className="stagegrid" style={{ "--accent": `var(${accent})` } as React.CSSProperties}>
      <section className="stage" aria-label="Selected round">
        <div className="stage-head">
          <div>
            <div className="eyebrow">
              Ch {channelLabel(listing.version)}
              {round ? ` · Round ${round.id}` : ""}
            </div>
            <h1 className="disp prize">
              {formatFigure(figure, token)}
              <small>{token.symbol}</small>
            </h1>
            <p className="prize-sub">{subtitle}</p>
          </div>
          <span className={`tag ${phase}`}>{phaseLabel(phase, round)}</span>
        </div>
        <div className="field">
          <StaticField
            ticketCount={config.ticketCount}
            sold={sold}
            mine={mine}
            winner={round && phase === "settled" ? round.winningTicket : null}
            accentVariable={accent}
            reveal={revealing ? reveal : null}
            tuneKey={listing.key}
            plate={plate}
            label={`${groupDigits(sold)} of ${groupDigits(config.ticketCount)} tickets sold. You hold ${held}.`}
          />
          {revealing ? (
            <div className="reveal on">
              <div className="plate">
                <b className="disp" ref={plate}>
                  0000
                </b>
                <span>seed mod {groupDigits(sold)}</span>
              </div>
            </div>
          ) : null}
        </div>
        <div className="stage-foot">
          <span>
            <b className="mono">{groupDigits(sold)}</b> of {groupDigits(config.ticketCount)} sold
          </span>
          {phase === "open" && round ? (
            <span>
              Deadline in <b className="mono">{countdown(round.expiresAt - now)}</b>
            </span>
          ) : null}
          {held ? (
            <span>
              You hold <b className="mono">{ticketRanges(mine)}</b>
            </span>
          ) : null}
          <span className="key">
            <i className="key-sold" />
            sold
          </span>
          <span className="key">
            <i className="key-mine" />
            yours
          </span>
        </div>
      </section>
      <aside className="ticket" aria-label="Round action">
        <TicketPanel listing={listing} reveal={reveal} onDraw={onDraw} />
      </aside>
    </div>
  );
}

function Split({ listing }: { listing: Listing }) {
  const { protocol } = useProtocol();
  const { config, rewards, round, phase } = listing;
  const token = tokenOf(protocol, config.paymentToken);
  const closed = phase !== "open" && phase !== "idle";
  const allocation = closed && round ? actualAllocation(round) : selloutAllocation(config, rewards);
  const gross = closed && round ? round.receipts : config.ticketPrice * BigInt(config.ticketCount);
  const parts = [
    {
      name: "Winner",
      amount: allocation.winner,
      color: "var(--signal)",
      note: `${config.winnerBps / 100}% of receipts`,
    },
    {
      name: "Operators",
      amount: allocation.operator,
      color: "var(--weth)",
      note: "through the Operator Router",
    },
    {
      name: "BONA stakers",
      amount: allocation.staker,
      color: "var(--win)",
      note: "booked at each purchase",
    },
    {
      name: "Recipient",
      amount: allocation.recipient,
      color: "var(--warn)",
      note: `${config.recipientBps / 100}% of receipts`,
    },
    {
      name: "Finalizer tip",
      amount: allocation.finalizer,
      color: "var(--ink)",
      note: "to whoever draws",
    },
    { name: "Treasury", amount: allocation.treasury, color: "var(--ink-3)", note: "the remainder" },
  ].filter((part) => part.amount > 0n);

  return (
    <section aria-label="Where the money goes">
      <div className="sectionhead">
        <h2 className="disp">Where it goes</h2>
        <span className="muted small-text">
          {closed ? "Actual receipts" : "If this round sells out"}: {formatToken(gross, token)}
        </span>
      </div>
      <div
        className="bar"
        role="img"
        aria-label={parts
          .map((part) => `${part.name} ${formatToken(part.amount, token)}`)
          .join(", ")}
      >
        {parts.map((part) => (
          <i
            key={part.name}
            style={{ flex: Number(part.amount / (gross / 10_000n || 1n)), background: part.color }}
          />
        ))}
      </div>
      <div className="legend">
        {parts.map((part) => (
          <div key={part.name}>
            <i style={{ background: part.color }} />
            {part.name}
            <b>{formatToken(part.amount, token)}</b>
            <span className="faint">{part.note}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Channels({
  selectedKey,
  onSelect,
}: {
  selectedKey: string;
  onSelect: (listing: Listing) => void;
}) {
  const { protocol, account, listings, now } = useProtocol();
  const [filter, setFilter] = useState("all");
  const symbols = [
    ...new Set(listings.map((listing) => tokenOf(protocol, listing.config.paymentToken).symbol)),
  ];
  const filters = [
    ["all", "All"],
    ...symbols.map((symbol) => [symbol, symbol]),
    ["ready", "Ready to draw"],
  ];
  const visible = listings.filter((listing) => {
    if (filter === "all") return true;
    if (filter === "ready") return listing.phase === "ready";
    return tokenOf(protocol, listing.config.paymentToken).symbol === filter;
  });

  return (
    <section aria-label="All rounds">
      <div className="sectionhead">
        <h2 className="disp">On air</h2>
        <div className="filters">
          {filters.map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        {visible.map((listing) => {
          const { config, round, phase } = listing;
          const token = tokenOf(protocol, config.paymentToken);
          const pot = round
            ? actualAllocation(round).winner
            : selloutAllocation(config, listing.rewards).winner;
          const remaining =
            phase === "open" && round
              ? countdown(round.expiresAt - now)
              : phase === "waiting" && round
                ? countdown(round.beaconAt - now)
                : round
                  ? `Round ${round.id}`
                  : "Opens on first buy";
          return (
            <button
              type="button"
              className="ch"
              key={listing.key}
              aria-current={listing.key === selectedKey ? "true" : undefined}
              onClick={() => onSelect(listing)}
            >
              <StaticField
                ticketCount={config.ticketCount}
                sold={round?.soldTickets ?? 0}
                mine={round && account ? (account.tickets[round.id.toString()] ?? []) : []}
                winner={round && phase === "settled" ? round.winningTicket : null}
                accentVariable={accentFor(token.symbol)}
              />
              <span className="ch-id">
                <span className="disp ch-num">{channelLabel(listing.version)}</span>
                <small>Ch</small>
              </span>
              <span className="val ch-pot">
                {formatToken(pot, token)}
                <small>
                  to the winner
                  {phase === "open" ? " so far" : phase === "idle" ? " at sellout" : ""}
                </small>
              </span>
              <span className="val ch-price">
                {formatToken(config.ticketPrice, token)}
                <small>per ticket</small>
              </span>
              <span className="val ch-sold">
                {groupDigits(round?.soldTickets ?? 0)} / {groupDigits(config.ticketCount)}
                <small>
                  sold{config.recipientBps ? ` · ${config.recipientBps / 100}% to recipient` : ""}
                </small>
              </span>
              <span className="ch-state">
                <span className={`tag ${phase}`}>{phaseLabel(phase, round)}</span>
                <small className="mono">{remaining}</small>
              </span>
            </button>
          );
        })}
        {visible.length === 0 ? (
          <p className="muted empty-row">No rounds match this filter.</p>
        ) : null}
      </div>
    </section>
  );
}

function HowItWorks() {
  return (
    <section className="how" aria-label="How a draw works">
      <div>
        <span className="eyebrow">01 Static</span>
        <h3 className="disp">Every ticket is a pixel</h3>
        <p>
          Rounds run side by side, each in its own token. Sales are final, and an unsold round still
          draws at its deadline.
        </p>
      </div>
      <div>
        <span className="eyebrow">02 Signal</span>
        <h3 className="disp">The beacon is fixed first</h3>
        <p>
          Each round names its drand beacon before that value exists. No fallback, no later round,
          no local entropy.
        </p>
      </div>
      <div>
        <span className="eyebrow">03 Winner</span>
        <h3 className="disp">Anyone can draw</h3>
        <p>
          Settling records every share without moving tokens. Winners and stakers then claim
          whenever they like.
        </p>
      </div>
    </section>
  );
}

type Selection = Readonly<{ key: string; version: bigint }>;

/**
 * A draw is followed from the click until its reveal ends. The result can reach the screen through
 * the receipt or through the regular poll, and the reveal starts with whichever comes first.
 */
type Draw = Readonly<{ roundId: bigint; reveal: Reveal | null }>;

// Kept outside the component so the selection survives a visit to another page.
let rememberedSelection: Selection | null = null;

export function RoundsView() {
  const { protocol, listings } = useProtocol();
  const params = useSearchParams();
  const router = useRouter();
  const requested = params.get("round");
  const [selection, setSelection] = useState<Selection | null>(() =>
    requested === null ? rememberedSelection : null
  );
  const [draw, setDraw] = useState<Draw | null>(null);
  const reveal = draw?.reveal ?? null;

  useEffect(() => {
    rememberedSelection = selection;
  }, [selection]);

  useEffect(() => {
    if (!reveal) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hold = reduced ? 600 : REVEAL_MS * REVEAL_HOLD;
    const timer = setTimeout(() => setDraw(null), hold);
    return () => clearTimeout(timer);
  }, [reveal]);

  const drawn =
    draw && !draw.reveal
      ? protocol.rounds.find(
          (round) => round.id === draw.roundId && round.status === RoundStatus.Settled
        )
      : undefined;
  if (drawn) {
    setDraw({
      roundId: drawn.id,
      reveal: { roundId: drawn.id, winner: drawn.winningTicket, startedAt: protocol.observedAtMs },
    });
  }

  const onDraw: DrawEvents = {
    started: (roundId) => setDraw({ roundId, reveal: null }),
    drawn: (next) =>
      setDraw((current) =>
        current?.roundId === next.roundId && !current.reveal
          ? { roundId: next.roundId, reveal: next }
          : current
      ),
    failed: (roundId) =>
      setDraw((current) => (current?.roundId === roundId && !current.reveal ? null : current)),
  };

  // The selection is whatever is on screen, so a draw or a new round elsewhere can't move it. A
  // channel's row changes key when its first buyer opens a round, so selection follows the channel.
  // Otherwise fall back to the round in the URL, then the top of the list.
  const selected =
    listings.find((listing) => listing.key === selection?.key) ??
    listings.find(
      (listing) => listing.version === selection?.version && listing.phase !== "settled"
    ) ??
    listings.find((listing) => requested !== null && listing.key === `round-${requested}`) ??
    listings[0];

  if (selected && selected.key !== selection?.key) {
    setSelection({ key: selected.key, version: selected.version });
  }

  if (!selected) {
    return (
      <div className="empty">
        <p>No rounds are on air yet.</p>
      </div>
    );
  }

  return (
    <>
      <Stage listing={selected} reveal={reveal} onDraw={onDraw} />
      <Split listing={selected} />
      <Channels
        selectedKey={selected.key}
        onSelect={(listing) => {
          setSelection({ key: listing.key, version: listing.version });
          if (requested) router.replace("/");
        }}
      />
      <HowItWorks />
    </>
  );
}
