const BPS = 10_000n;

export const STAKE_LOCK_SECONDS = 86_400n;
export const BASE_MULTIPLIER_BPS = 10_000n;

export type AllocationConfig = Readonly<{
  winnerBps: number;
  operatorProtocolBps: number;
  recipientBps: number;
  finalizerTip: bigint;
}>;

export type Allocation = Readonly<{
  winner: bigint;
  operator: bigint;
  staker: bigint;
  recipient: bigint;
  finalizer: bigint;
  treasury: bigint;
}>;

/** Mirrors `LibBonanzaStaking.stakerShare`: one floor per purchase. */
export function stakerShare(amount: bigint, winnerBps: number, stakerProtocolBps: number): bigint {
  return (amount * (BPS - BigInt(winnerBps)) * BigInt(stakerProtocolBps)) / (BPS * BPS);
}

/**
 * Mirrors `SettlementFacet._allocateValues`. `stakerBooked` is the round's booked total for actual
 * receipts, or a projection when previewing a sellout.
 */
export function allocate(
  config: AllocationConfig,
  gross: bigint,
  stakerBooked: bigint
): Allocation {
  const winner = (gross * BigInt(config.winnerBps)) / BPS;
  const protocol = gross - winner;
  const operator = (protocol * BigInt(config.operatorProtocolBps)) / BPS;
  const recipient = (gross * BigInt(config.recipientBps)) / BPS;
  const remainder = protocol - operator - stakerBooked - recipient;
  const finalizer = config.finalizerTip < remainder ? config.finalizerTip : remainder;
  return {
    winner,
    operator,
    staker: stakerBooked,
    recipient,
    finalizer,
    treasury: remainder - finalizer,
  };
}

/** Mirrors the weighted lock reset in `BonanzaStakingFacet.stakeBonanza`. */
export function nextStakeStart(
  staked: bigint,
  stakeStart: bigint,
  added: bigint,
  now: bigint
): bigint {
  if (staked === 0n) return now;
  const served = now - stakeStart;
  const credit = served < STAKE_LOCK_SECONDS ? served : STAKE_LOCK_SECONDS;
  return now - (staked * credit) / (staked + added);
}

export function unlockAt(stakeStart: bigint): bigint {
  return stakeStart + STAKE_LOCK_SECONDS;
}
