"use client";

import Link from "next/link";
import { useState } from "react";
import { decodeEventLog, erc20Abi, type TransactionReceipt } from "viem";

import { TxButton } from "@/components/shell/TxButton";
import { useWalletGate } from "@/components/shell/WalletGate";
import { CREATE_POSITION_KEY, useCreatePosition } from "@/components/shell/usePositionActions";
import { fetchBeacon } from "@/lib/chain/drand";
import { deployment, publicClient } from "@/lib/chain/client";
import { lotteryAbi } from "@/lib/contracts/generated/lottery";
import {
  countdown,
  formatAmount,
  formatToken,
  groupDigits,
  percent,
  shortAddress,
  ticketLabel,
  ticketRanges,
  ticketTotal,
} from "@/lib/protocol/format";
import {
  actualAllocation,
  phaseLabel,
  purchaseLimit,
  tokenOf,
  type Listing,
} from "@/lib/protocol/rounds";
import { RoundStatus } from "@/lib/protocol/types";
import { useProtocol } from "@/providers/protocol-context";
import { useToast } from "@/providers/toast-context";
import { useTx } from "@/providers/tx-context";
import { useWalletState } from "@/providers/wallet-context";

import type { Reveal } from "./StaticField";

export type DrawEvents = Readonly<{
  started: (roundId: bigint) => void;
  drawn: (reveal: Reveal) => void;
  failed: (roundId: bigint) => void;
}>;

function RoundEyebrow({ text }: { text: string }) {
  return <div className="eyebrow">{text}</div>;
}

function PositionSelect({
  value,
  onChange,
}: {
  value: bigint | null;
  onChange: (id: bigint) => void;
}) {
  const { account } = useProtocol();
  if (!account?.positions.length) return null;
  return (
    <label className="field-label">
      BONANZA goes to position
      <select
        value={value?.toString() ?? ""}
        onChange={(event) => onChange(BigInt(event.target.value))}
      >
        {account.positions.map((position) => (
          <option key={position.id.toString()} value={position.id.toString()}>
            Position #{position.id.toString()}
          </option>
        ))}
      </select>
    </label>
  );
}

function OpenPanel({ listing }: { listing: Listing }) {
  const { protocol, account } = useProtocol();
  const { busy, run } = useTx();
  const gate = useWalletGate();
  const createPosition = useCreatePosition();
  const { config, rewards, round } = listing;
  const token = tokenOf(protocol, config.paymentToken);
  const sold = round?.soldTickets ?? 0;
  const limit = purchaseLimit(config, sold);
  const [quantity, setQuantity] = useState(Math.min(5, limit));
  const [chosenPosition, setChosenPosition] = useState<bigint | null>(null);

  const positions = account?.positions ?? [];
  const positionId = chosenPosition ?? positions[0]?.id ?? null;
  const needsPosition = rewards.participation;
  const cost = config.ticketPrice * BigInt(quantity);
  const balance = account?.balances[token.address] ?? 0n;
  const allowance = account?.allowances[token.address] ?? 0n;
  const mine = round && account ? ticketTotal(account.tickets[round.id.toString()] ?? []) : 0;
  const issued = (() => {
    const requested = rewards.unitsPerTicket * BigInt(quantity);
    return requested < protocol.reserve.inventory ? requested : protocol.reserve.inventory;
  })();
  const bonanza = {
    symbol: "BONANZA",
    decimals: tokenOf(protocol, protocol.bindings.underlying).decimals,
  };
  const valid = quantity >= 1 && quantity <= limit;
  const presets = [...new Set([1, 5, 10, limit])].filter((value) => value <= limit);
  // Keyed by channel, so an error stays with its round and survives the round opening.
  const buyKey = `buy-${listing.version}`;
  const approveKey = `approve-${listing.version}`;

  const buy = () =>
    run(
      buyKey,
      async () => {
        const position = needsPosition ? positionId! : (positionId ?? 0n);
        const call = { address: deployment!.lottery, abi: lotteryAbi };
        if (round) {
          return needsPosition
            ? {
                ...call,
                functionName: "buyTicketsForPosition",
                args: [round.id, quantity, position],
              }
            : { ...call, functionName: "buyTickets", args: [round.id, quantity] };
        }
        return needsPosition
          ? {
              ...call,
              functionName: "openRoundForPosition",
              args: [listing.version, quantity, position],
            }
          : { ...call, functionName: "openRound", args: [listing.version, quantity] };
      },
      {
        action: `Buy ${quantity} ticket${quantity > 1 ? "s" : ""}`,
        pending: "Buying…",
        success: `Bought ${quantity} ticket${quantity > 1 ? "s" : ""}`,
      }
    );

  const approve = () =>
    run(
      approveKey,
      async () => ({
        address: token.address,
        abi: erc20Abi,
        functionName: "approve",
        args: [deployment!.lottery, cost],
      }),
      { action: `Approve ${formatToken(cost, token)}`, success: "Approved" }
    );

  const action = () => {
    if (gate) return gate;
    // A transaction keeps its own button until it finishes, whatever the next poll shows.
    if (busy[approveKey]) return <TxButton txKey={approveKey}>Approve</TxButton>;
    if (busy[buyKey]) return <TxButton txKey={buyKey}>Buy</TxButton>;
    if (protocol.paused) {
      return (
        <TxButton txKey={buyKey} disabled>
          Buying is paused
        </TxButton>
      );
    }
    if (!valid) {
      return (
        <>
          <TxButton txKey={buyKey} disabled>
            Choose a ticket count
          </TxButton>
          <p className="why">
            Between 1 and {groupDigits(limit)} ticket{limit === 1 ? "" : "s"} in one purchase.
          </p>
        </>
      );
    }
    if (!account) {
      return (
        <TxButton txKey={buyKey} disabled>
          Reading your wallet…
        </TxButton>
      );
    }
    if (needsPosition && positions.length === 0) {
      return (
        <>
          <TxButton txKey={CREATE_POSITION_KEY} onClick={createPosition}>
            Create a position
          </TxButton>
          <p className="why">This round pays BONANZA into a Statics position.</p>
        </>
      );
    }
    if (cost > balance) {
      return (
        <>
          <TxButton txKey={buyKey} disabled>
            Not enough {token.symbol}
          </TxButton>
          <p className="why">You have {formatToken(balance, token)}.</p>
        </>
      );
    }
    if (allowance < cost) {
      return (
        <TxButton txKey={approveKey} onClick={() => void approve()}>
          Approve {formatToken(cost, token)}
        </TxButton>
      );
    }
    const verb = round ? "Buy" : "Open round · buy";
    return (
      <TxButton txKey={buyKey} onClick={() => void buy()}>
        {verb} {quantity} ticket{quantity > 1 ? "s" : ""}
      </TxButton>
    );
  };

  return (
    <>
      <RoundEyebrow
        text={round ? `Ticket stub · Round ${round.id}` : `Ticket stub · Ch ${listing.version}`}
      />
      <h2 className="disp stub-price">
        {formatToken(config.ticketPrice, token)}
        <span className="muted each"> each</span>
      </h2>
      {account ? <div className="stub-balance">Balance {formatToken(balance, token)}</div> : null}
      <div className="stepper">
        <button
          type="button"
          aria-label="One fewer ticket"
          disabled={quantity <= 1}
          onClick={() => setQuantity((value) => Math.max(1, value - 1))}
        >
          −
        </button>
        <input
          type="number"
          min={1}
          max={limit}
          value={quantity || ""}
          inputMode="numeric"
          aria-label="Number of tickets"
          onChange={(event) => setQuantity(Number.parseInt(event.target.value, 10) || 0)}
        />
        <button
          type="button"
          aria-label="One more ticket"
          disabled={quantity >= limit}
          onClick={() => setQuantity((value) => Math.min(limit, value + 1))}
        >
          +
        </button>
      </div>
      <div className="presets">
        {presets.map((value) => (
          <button type="button" key={value} onClick={() => setQuantity(value)}>
            {value === limit ? `Max ${value}` : value}
          </button>
        ))}
      </div>
      {needsPosition ? <PositionSelect value={positionId} onChange={setChosenPosition} /> : null}
      <div className="perf" />
      <div className="rowline">
        <span>Cost</span>
        <span className="mono">{formatToken(cost, token)}</span>
      </div>
      <div className="rowline">
        <span>Your odds now</span>
        <span className="mono">
          {groupDigits(mine + quantity)} of {groupDigits(sold + quantity)} ·{" "}
          {percent(BigInt(mine + quantity), BigInt(Math.max(sold + quantity, 1)))}
          <span className="sub">Shifts as others buy</span>
        </span>
      </div>
      {rewards.participation ? (
        <div className="rowline">
          <span>BONANZA reward</span>
          <span className="mono">
            {issued > 0n ? `+${formatToken(issued, bonanza)}` : "None"}
            {issued > 0n ? null : <span className="sub">Reward inventory is empty</span>}
          </span>
        </div>
      ) : null}
      {action()}
      <p className="note">
        Sales are final. If the round hasn&apos;t sold out at its deadline, it draws among the
        tickets sold and pays from actual receipts.
      </p>
    </>
  );
}

function WaitingPanel({ listing }: { listing: Listing }) {
  const { protocol, now } = useProtocol();
  const round = listing.round!;
  const token = tokenOf(protocol, round.config.paymentToken);
  const split = actualAllocation(round);
  return (
    <>
      <RoundEyebrow text={`Sales closed · Round ${round.id}`} />
      <h2 className="disp stub-price">
        Beacon
        <br />
        in {countdown(round.beaconAt - now)}
      </h2>
      <div className="perf" />
      <div className="rowline">
        <span>Committed beacon</span>
        <span className="mono">{groupDigits(round.drandRound)}</span>
      </div>
      <div className="rowline">
        <span>Tickets in the draw</span>
        <span className="mono">{groupDigits(round.soldTickets)}</span>
      </div>
      <div className="rowline">
        <span>Winner receives</span>
        <span className="mono">{formatToken(split.winner, token)}</span>
      </div>
      <p className="note">
        This beacon was fixed before its value existed, and there is no fallback. The round waits
        for this exact one.
      </p>
    </>
  );
}

function ReadyPanel({ listing, onDraw }: { listing: Listing; onDraw: DrawEvents }) {
  const { protocol } = useProtocol();
  const { run } = useTx();
  const toast = useToast();
  const gate = useWalletGate();
  const round = listing.round!;
  const token = tokenOf(protocol, round.config.paymentToken);
  const split = actualAllocation(round);
  const key = `settle-${round.id}`;

  const draw = async () => {
    onDraw.started(round.id);
    const done = await run(
      key,
      async () => {
        const beacon = await fetchBeacon(round.drandRound);
        return {
          address: deployment!.lottery,
          abi: lotteryAbi,
          functionName: "settleRound",
          args: [round.id, beacon.signature],
        };
      },
      {
        action: `Draw round ${round.id}`,
        pending: "Posting beacon…",
        success:
          split.finalizer > 0n
            ? `Round ${round.id} drawn. Your tip is in Claims.`
            : `Round ${round.id} drawn.`,
        onReceipt: (receipt: TransactionReceipt) => {
          for (const log of receipt.logs) {
            try {
              const event = decodeEventLog({ abi: lotteryAbi, data: log.data, topics: log.topics });
              if (event.eventName === "RoundSettled") {
                onDraw.drawn({
                  roundId: round.id,
                  winner: event.args.winningTicket,
                  startedAt: Date.now(),
                });
              }
            } catch {
              // Token and registry logs in the same receipt aren't Lottery events.
            }
          }
        },
      }
    );
    if (done) return;
    onDraw.failed(round.id);
    const latest = await publicClient
      .readContract({
        address: deployment!.lottery,
        abi: lotteryAbi,
        functionName: "round",
        args: [round.id],
      })
      .catch(() => null);
    if (latest?.status === RoundStatus.Settled) toast(`Someone else drew round ${round.id} first.`);
  };

  return (
    <>
      <RoundEyebrow text={`${phaseLabel("ready", round)} · Round ${round.id}`} />
      <h2 className="disp stub-price">
        The beacon
        <br />
        is in
      </h2>
      <p className="muted stub-copy">
        Anyone can post it and draw this round. Whoever does collects the tip.
      </p>
      <div className="perf" />
      <div className="rowline">
        <span>Finalizer tip</span>
        <span className="mono">{formatToken(split.finalizer, token)}</span>
      </div>
      <div className="rowline">
        <span>Beacon</span>
        <span className="mono">{groupDigits(round.drandRound)}</span>
      </div>
      <div className="rowline">
        <span>Tickets in the draw</span>
        <span className="mono">
          {groupDigits(round.soldTickets)}
          {round.soldTickets < round.config.ticketCount
            ? ` of ${groupDigits(round.config.ticketCount)}`
            : ""}
        </span>
      </div>
      {gate ?? (
        <TxButton txKey={key} onClick={() => void draw()}>
          Draw round · earn {formatToken(split.finalizer, token)}
        </TxButton>
      )}
    </>
  );
}

function SettledPanel({ listing }: { listing: Listing }) {
  const { protocol, account } = useProtocol();
  const { address } = useWalletState();
  const round = listing.round!;
  const token = tokenOf(protocol, round.config.paymentToken);
  const split = actualAllocation(round);
  const won = address !== null && round.winner.toLowerCase() === address.toLowerCase();
  const mine = account?.tickets[round.id.toString()];
  return (
    <>
      <RoundEyebrow text={`Drawn · Round ${round.id}`} />
      <h2 className={`disp stub-price ${won ? "won" : ""}`}>
        {won ? "You won" : `Ticket ${ticketLabel(round.winningTicket)}`}
      </h2>
      <div className="perf" />
      <div className="rowline">
        <span>Winning ticket</span>
        <span className="mono">{ticketLabel(round.winningTicket)}</span>
      </div>
      <div className="rowline">
        <span>Winner</span>
        <span className="mono">{shortAddress(round.winner)}</span>
      </div>
      <div className="rowline">
        <span>Winner receives</span>
        <span className="mono">{formatToken(split.winner, token)}</span>
      </div>
      {mine ? (
        <div className="rowline">
          <span>You held</span>
          <span className="mono">{ticketRanges(mine)}</span>
        </div>
      ) : null}
      <div className="rowline">
        <span>Check the math</span>
        <span className="mono">
          {shortAddress(round.applicationSeed)} mod {groupDigits(round.soldTickets)}
        </span>
      </div>
      {won && round.winnerClaimable > 0n ? (
        <Link className="btn win" href="/claims">
          Claim {formatAmount(round.winnerClaimable, token.decimals, 2)} {token.symbol}
        </Link>
      ) : null}
    </>
  );
}

export function TicketPanel({
  listing,
  reveal,
  onDraw,
}: {
  listing: Listing;
  reveal: Reveal | null;
  onDraw: DrawEvents;
}) {
  const round = listing.round;
  if (reveal && round && reveal.roundId === round.id) {
    return (
      <>
        <RoundEyebrow text={`Drawing · Round ${round.id}`} />
        <h2 className="disp stub-price">
          Signal
          <br />
          locking
        </h2>
        <div className="perf" />
        <p className="muted">
          Applying beacon {groupDigits(round.drandRound)} to {groupDigits(round.soldTickets)}{" "}
          tickets.
        </p>
      </>
    );
  }
  if (listing.phase === "open" || listing.phase === "idle") {
    // Keyed by channel, so the ticket count survives the channel's first buyer opening a round.
    return <OpenPanel key={listing.version.toString()} listing={listing} />;
  }
  if (listing.phase === "waiting") return <WaitingPanel listing={listing} />;
  if (listing.phase === "ready") return <ReadyPanel listing={listing} onDraw={onDraw} />;
  return <SettledPanel listing={listing} />;
}
