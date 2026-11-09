import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

const CONTRACT_ERRORS: Readonly<Record<string, string>> = {
  AccountNotEmpty: "This account still holds BONA or unclaimed revenue.",
  ActiveRoundLimitReached: "The maximum number of live rounds is running. Try again after a draw.",
  ConfigAlreadyActive: "Someone just opened this round. Buy into it instead.",
  ConfigDisabled: "This channel isn't accepting new rounds.",
  ConversionDisabled: "This conversion is closed.",
  ERC20InsufficientAllowance: "Approve a larger amount first.",
  ERC20InsufficientBalance: "Your balance is too low for this.",
  InexactTokenTransfer: "The token moved an unexpected amount, so the transaction was reversed.",
  InsufficientFiddy: "This position doesn't have enough unstaked BONA.",
  InvalidAddress: "That receiver can't accept this payment.",
  InvalidRandomnessRound: "This round's beacon can't be scheduled right now.",
  InvalidRegistration: "This Operator can't be registered. Check that you own it and it's active.",
  InvalidTicketQuantity: "That's more tickets than are left.",
  NoFinalizerCredit: "There is no tip to claim.",
  NoRecipientRevenue: "There is no recipient revenue to claim.",
  NotPositionOwner: "This wallet doesn't own that position.",
  NotRecipient: "This wallet isn't the round's recipient.",
  NotWinner: "This wallet didn't win that round.",
  NoWinnerClaim: "This prize has already been claimed.",
  OperatorAlreadyRegistered: "That Operator is registered to another account.",
  OperatorRouterUnavailable: "Operator payouts aren't available for this token right now.",
  PositionRequired: "This round pays BONA, so it needs a position.",
  ProtocolPaused: "The protocol is paused. Draws, claims and exits still work.",
  RandomnessPredatesClose:
    "That beacon was posted before sales closed, so it can't draw this round.",
  RandomnessUnavailable: "The registry rejected that beacon. Try again in a moment.",
  ReceiverRestricted: "BONA can't be sent to that receiver.",
  RoundExpired: "Sales for this round have closed.",
  RoundNotOpen: "This round is no longer on sale.",
  RoundNotReady: "This round can't be drawn yet.",
  RoundNotSettled: "This round hasn't been drawn yet.",
  StakeLocked: "This stake is still locked.",
  StaleRandomnessRound: "That beacon has already been posted, so the round can't open.",
  TicketLimitExceeded: "That's more tickets than one purchase allows.",
  TransferRestricted: "BONA can only move through approved paths.",
  WrapCapacityExceeded: "That's more than the wrap cap has left.",
  ZeroAmount: "Enter an amount above zero.",
};

const REJECTED = "You rejected the request in your wallet. Nothing was spent.";
const FALLBACK = "The transaction didn't go through. Nothing was spent.";

export function rejectedByUser(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === 4001 || candidate.code === UserRejectedRequestError.code) return true;
    if (
      typeof candidate.message === "string" &&
      /user (rejected|denied|exited)|rejected the request/i.test(candidate.message)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/** The contract's own reason for a revert in plain words, or null when the error names none. */
export function revertReason(error: unknown): string | null {
  if (!(error instanceof BaseError)) return null;
  const revert = error.walk((cause) => cause instanceof ContractFunctionRevertedError);
  if (!(revert instanceof ContractFunctionRevertedError)) return null;
  const name = revert.data?.errorName;
  if (name && CONTRACT_ERRORS[name]) return CONTRACT_ERRORS[name];
  return revert.reason ?? null;
}

export function explainError(error: unknown): string {
  if (rejectedByUser(error)) return REJECTED;
  if (error instanceof BaseError) return revertReason(error) ?? FALLBACK;
  // Wallet and app errors are written for people; anything else stays generic.
  if (
    error instanceof Error &&
    error.message.length < 160 &&
    !/0x[0-9a-f]{8}/i.test(error.message)
  ) {
    return error.message;
  }
  return FALLBACK;
}
