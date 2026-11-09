import type { Address, Hex } from "viem";

import type { TicketRange } from "./format";

export type Token = Readonly<{ address: Address; symbol: string; decimals: number }>;

export type RoundConfig = Readonly<{
  paymentToken: Address;
  ticketPrice: bigint;
  ticketCount: number;
  salesDuration: number;
  randomnessDelay: number;
  maxTicketsPerPurchase: number;
  winnerBps: number;
  operatorProtocolBps: number;
  recipientBps: number;
  recipient: Address;
  finalizerTip: bigint;
}>;

export type Rewards = Readonly<{
  unitsPerTicket: bigint;
  stakerProtocolBps: number;
  participation: boolean;
}>;

export type Channel = Readonly<{
  version: bigint;
  config: RoundConfig;
  rewards: Rewards;
  enabled: boolean;
  activeRoundId: bigint;
}>;

export const RoundStatus = { None: 0, Open: 1, SoldOut: 2, Settled: 3 } as const;

export type Round = Readonly<{
  id: bigint;
  configVersion: bigint;
  config: RoundConfig;
  rewards: Rewards;
  stakerBooked: bigint;
  status: number;
  openedAt: bigint;
  expiresAt: bigint;
  selloutAt: bigint;
  settledAt: bigint;
  drandRound: bigint;
  beaconAt: bigint;
  soldTickets: number;
  winningTicket: number;
  winner: Address;
  receipts: bigint;
  winnerClaimable: bigint;
  recipientClaimable: bigint;
  applicationSeed: Hex;
}>;

export type Reserve = Readonly<{
  inventory: bigint;
  backing: bigint;
  custody: bigint;
  wrapEnabled: boolean;
  unwrapEnabled: boolean;
  wrapCap: bigint;
  wrapOutstanding: bigint;
}>;

export type ProtocolSnapshot = Readonly<{
  blockNumber: bigint;
  blockTimestamp: bigint;
  observedAtMs: number;
  paused: boolean;
  bindings: Readonly<{
    underlying: Address;
    positionNFT: Address;
    operators: Address;
    registry: Address;
  }>;
  drandRegistry: Address;
  reserve: Reserve;
  totalWeight: bigint;
  boostsEnabled: boolean;
  revenueAssets: readonly Address[];
  channels: readonly Channel[];
  rounds: readonly Round[];
  tokens: Readonly<Record<Address, Token>>;
}>;

export type StakingAccount = Readonly<{
  id: bigint;
  balance: bigint;
  staked: bigint;
  weight: bigint;
  operatorId: bigint;
  multiplierBps: bigint;
  stakeStart: bigint;
  registered: boolean;
  revenue: Readonly<Record<Address, bigint>>;
}>;

export type AccountSnapshot = Readonly<{
  owner: Address;
  nativeBalance: bigint;
  positionCreationFee: bigint;
  balances: Readonly<Record<Address, bigint>>;
  allowances: Readonly<Record<Address, bigint>>;
  positions: readonly StakingAccount[];
  tickets: Readonly<Record<string, readonly TicketRange[]>>;
  olderRounds: readonly Round[];
  finalizerCredits: Readonly<Record<Address, bigint>>;
}>;

/** Protocol and wallet state read at one block, so a screen never mixes two moments. */
export type Snapshot = Readonly<{ protocol: ProtocolSnapshot; account: AccountSnapshot | null }>;
