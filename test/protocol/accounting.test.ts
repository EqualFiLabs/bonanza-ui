import { describe, expect, it } from "vitest";

import {
  allocate,
  nextStakeStart,
  stakerShare,
  STAKE_LOCK_SECONDS,
} from "@/lib/protocol/accounting";

const config = { winnerBps: 5_000, operatorProtocolBps: 4_000, recipientBps: 0, finalizerTip: 5n };

describe("allocate", () => {
  it("conserves every unit of receipts across the split", () => {
    for (const gross of [0n, 1n, 7n, 999n, 10n ** 18n + 3n]) {
      for (const recipientBps of [0, 500, 1_500]) {
        const staker = stakerShare(gross, 5_000, 2_500);
        const split = allocate({ ...config, recipientBps }, gross, staker);
        const total =
          split.winner +
          split.operator +
          split.staker +
          split.recipient +
          split.finalizer +
          split.treasury;
        expect(total).toBe(gross);
      }
    }
  });

  it("caps the finalizer tip at what the Treasury would otherwise keep", () => {
    const split = allocate({ ...config, finalizerTip: 10n ** 30n }, 1_000n, 125n);
    expect(split.finalizer).toBe(1_000n - 500n - 200n - 125n);
    expect(split.treasury).toBe(0n);
  });

  it("takes the recipient share from gross, not from the protocol share", () => {
    expect(allocate({ ...config, recipientBps: 500 }, 10_000n, 0n).recipient).toBe(500n);
  });

  it("rounds the winner down and leaves the dust in the protocol share", () => {
    const split = allocate({ ...config, finalizerTip: 0n }, 3n, 0n);
    expect(split.winner).toBe(1n);
    expect(split.operator + split.treasury).toBe(2n);
  });
});

describe("stakerShare", () => {
  it("applies one floor to the purchase", () => {
    expect(stakerShare(1_000n, 5_000, 2_500)).toBe(125n);
    expect(stakerShare(7n, 5_000, 2_500)).toBe(0n);
  });

  it("is zero when the round books nothing to stakers", () => {
    expect(stakerShare(10n ** 18n, 5_000, 0)).toBe(0n);
  });
});

describe("nextStakeStart", () => {
  const now = 1_000_000n;

  it("starts the lock now on a first stake", () => {
    expect(nextStakeStart(0n, 0n, 50n, now)).toBe(now);
  });

  it("credits served time weighted by the prior stake", () => {
    const start = now - 6n * 3_600n;
    expect(nextStakeStart(300n, start, 100n, now)).toBe(now - (3n * 21_600n) / 4n);
  });

  it("caps credit at the full lock", () => {
    const start = now - 10n * STAKE_LOCK_SECONDS;
    expect(nextStakeStart(100n, start, 100n, now)).toBe(now - STAKE_LOCK_SECONDS / 2n);
  });

  it("rounds toward a longer lock", () => {
    expect(nextStakeStart(1n, now - 5n, 2n, now)).toBe(now - 1n);
  });
});
