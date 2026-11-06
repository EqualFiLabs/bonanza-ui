import { describe, expect, it } from "vitest";
import { zeroAddress, zeroHash } from "viem";

import {
  buildListings,
  phaseLabel,
  purchaseLimit,
  roundPhase,
  selloutAllocation,
} from "@/lib/protocol/rounds";
import { RoundStatus, type ProtocolSnapshot, type Round } from "@/lib/protocol/types";

const config = {
  paymentToken: zeroAddress,
  ticketPrice: 100n,
  ticketCount: 40,
  salesDuration: 600,
  randomnessDelay: 6,
  maxTicketsPerPurchase: 20,
  winnerBps: 5_000,
  operatorProtocolBps: 4_000,
  recipientBps: 0,
  recipient: zeroAddress,
  finalizerTip: 10n,
};
const rewards = { unitsPerTicket: 1n, stakerProtocolBps: 2_500, participation: true };

function makeRound(overrides: Partial<Round> = {}): Round {
  return {
    id: 1n,
    configVersion: 2n,
    config,
    rewards,
    stakerBooked: 0n,
    status: RoundStatus.Open,
    openedAt: 0n,
    expiresAt: 1_000n,
    selloutAt: 0n,
    settledAt: 0n,
    drandRound: 9n,
    beaconAt: 1_010n,
    soldTickets: 10,
    winningTicket: 0,
    winner: zeroAddress,
    receipts: 1_000n,
    winnerClaimable: 0n,
    recipientClaimable: 0n,
    applicationSeed: zeroHash,
    ...overrides,
  };
}

describe("roundPhase", () => {
  it("is on sale until the deadline", () => {
    expect(roundPhase(makeRound(), 999n)).toBe("open");
  });

  it("closes exactly at the deadline, as the contract does", () => {
    expect(roundPhase(makeRound(), 1_000n)).toBe("waiting");
  });

  it("becomes drawable when the committed beacon's time arrives", () => {
    expect(roundPhase(makeRound(), 1_009n)).toBe("waiting");
    expect(roundPhase(makeRound(), 1_010n)).toBe("ready");
  });

  it("closes early on a sellout", () => {
    const round = makeRound({ status: RoundStatus.SoldOut, beaconAt: 500n });
    expect(roundPhase(round, 400n)).toBe("waiting");
    expect(roundPhase(round, 500n)).toBe("ready");
  });

  it("stays drawn once settled", () => {
    expect(roundPhase(makeRound({ status: RoundStatus.Settled }), 0n)).toBe("settled");
  });
});

describe("phaseLabel", () => {
  it("names an unsold round's draw differently", () => {
    expect(phaseLabel("ready", makeRound())).toBe("Deadline draw ready");
    expect(phaseLabel("ready", makeRound({ soldTickets: 40 }))).toBe("Ready to draw");
  });
});

describe("purchaseLimit", () => {
  it("is the smaller of the per-purchase limit and tickets left", () => {
    expect(purchaseLimit(config, 0)).toBe(20);
    expect(purchaseLimit(config, 35)).toBe(5);
  });

  it("treats a zero limit as no limit", () => {
    expect(purchaseLimit({ ...config, maxTicketsPerPurchase: 0 }, 5)).toBe(35);
  });
});

describe("selloutAllocation", () => {
  it("projects the staker share across the whole round", () => {
    const split = selloutAllocation(config, rewards);
    expect(split.winner).toBe(2_000n);
    expect(split.staker).toBe(500n);
  });
});

describe("buildListings", () => {
  const protocol = {
    rounds: [
      makeRound({ id: 1n, configVersion: 1n, status: RoundStatus.Settled, settledAt: 5n }),
      makeRound({ id: 2n, configVersion: 2n }),
      makeRound({ id: 3n, configVersion: 3n, expiresAt: 10n, beaconAt: 20n }),
    ],
    channels: [
      { version: 1n, config, rewards, enabled: true, activeRoundId: 0n },
      { version: 2n, config, rewards, enabled: true, activeRoundId: 2n },
      { version: 3n, config, rewards, enabled: true, activeRoundId: 3n },
      { version: 4n, config, rewards, enabled: false, activeRoundId: 0n },
    ],
  } as unknown as ProtocolSnapshot;

  it("lists drawable rounds first and drawn rounds last", () => {
    const keys = buildListings(protocol, 100n).map((listing) => listing.key);
    expect(keys).toEqual(["round-3", "round-2", "channel-1", "round-1"]);
  });

  it("shows an idle channel only while it's enabled", () => {
    const keys = buildListings(protocol, 100n).map((listing) => listing.key);
    expect(keys).not.toContain("channel-4");
    expect(keys).not.toContain("channel-2");
  });
});
