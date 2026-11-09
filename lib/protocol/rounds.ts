import type { Address } from "viem";

import { allocate, stakerShare, type Allocation } from "./accounting";
import type { Channel, ProtocolSnapshot, Rewards, Round, RoundConfig, Token } from "./types";
import { RoundStatus } from "./types";

export type Phase = "idle" | "open" | "waiting" | "ready" | "settled";

export function roundPhase(round: Round, now: bigint): Phase {
  if (round.status === RoundStatus.Settled) return "settled";
  const salesOpen = round.status === RoundStatus.Open && now < round.expiresAt;
  if (salesOpen) return "open";
  return now >= round.beaconAt ? "ready" : "waiting";
}

export function phaseLabel(phase: Phase, round: Round | null): string {
  if (phase === "idle") return "Ready to open";
  if (phase === "open") return "On sale";
  if (phase === "waiting") return "Waiting for beacon";
  if (phase === "settled") return "Drawn";
  return round && round.soldTickets < round.config.ticketCount
    ? "Deadline draw ready"
    : "Ready to draw";
}

/** One row of the rounds list: a live or past round, or an enabled channel with none running. */
export type Listing = Readonly<{
  key: string;
  version: bigint;
  config: RoundConfig;
  rewards: Rewards;
  round: Round | null;
  phase: Phase;
}>;

const PHASE_ORDER: Readonly<Record<Phase, number>> = {
  ready: 0,
  open: 1,
  idle: 2,
  waiting: 3,
  settled: 4,
};
const SETTLED_SHOWN = 6;

export function buildListings(protocol: ProtocolSnapshot, now: bigint): Listing[] {
  const fromRound = (round: Round): Listing => ({
    key: `round-${round.id}`,
    version: round.configVersion,
    config: round.config,
    rewards: round.rewards,
    round,
    phase: roundPhase(round, now),
  });
  const fromChannel = (channel: Channel): Listing => ({
    key: `channel-${channel.version}`,
    version: channel.version,
    config: channel.config,
    rewards: channel.rewards,
    round: null,
    phase: "idle",
  });

  const live = protocol.rounds.filter((round) => round.status !== RoundStatus.Settled);
  const settled = protocol.rounds
    .filter((round) => round.status === RoundStatus.Settled)
    .sort((left, right) => Number(right.settledAt - left.settledAt))
    .slice(0, SETTLED_SHOWN);
  const idle = protocol.channels.filter(
    (channel) => channel.enabled && channel.activeRoundId === 0n
  );

  return [...live.map(fromRound), ...idle.map(fromChannel), ...settled.map(fromRound)].sort(
    (left, right) =>
      PHASE_ORDER[left.phase] - PHASE_ORDER[right.phase] ||
      Number((left.round?.expiresAt ?? 0n) - (right.round?.expiresAt ?? 0n))
  );
}

export function actualAllocation(round: Round): Allocation {
  return allocate(round.config, round.receipts, round.stakerBooked);
}

/** What the split would be if every ticket sells at the configured price. */
export function selloutAllocation(config: RoundConfig, rewards: Rewards): Allocation {
  const gross = config.ticketPrice * BigInt(config.ticketCount);
  return allocate(config, gross, stakerShare(gross, config.winnerBps, rewards.stakerProtocolBps));
}

export function purchaseLimit(config: RoundConfig, sold: number): number {
  const left = config.ticketCount - sold;
  return config.maxTicketsPerPurchase ? Math.min(config.maxTicketsPerPurchase, left) : left;
}

export function tokenOf(protocol: ProtocolSnapshot, address: Address): Token {
  const token = protocol.tokens[address];
  if (!token) throw new Error(`Unknown token ${address}.`);
  return token;
}
