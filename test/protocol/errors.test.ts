import {
  BaseError,
  ContractFunctionRevertedError,
  encodeErrorResult,
  UserRejectedRequestError,
} from "viem";
import { describe, expect, it } from "vitest";

import { lotteryAbi } from "@/lib/contracts/generated/lottery";
import { explainError } from "@/lib/protocol/errors";

function reverted(data: `0x${string}`): BaseError {
  return new BaseError("reverted", {
    cause: new ContractFunctionRevertedError({ abi: lotteryAbi, data, functionName: "buyTickets" }),
  });
}

describe("explainError", () => {
  it("names a wallet rejection and says nothing moved", () => {
    expect(explainError(Object.assign(new Error("no"), { code: 4001 }))).toMatch(/rejected/);
    expect(explainError(new UserRejectedRequestError(new Error("no")))).toMatch(/rejected/);
  });

  it("translates a decoded contract error", () => {
    const data = encodeErrorResult({ abi: lotteryAbi, errorName: "ProtocolPaused" });
    expect(explainError(reverted(data))).toMatch(/paused/);
  });

  it("translates an error carrying arguments", () => {
    const data = encodeErrorResult({ abi: lotteryAbi, errorName: "StakeLocked", args: [100n] });
    expect(explainError(reverted(data))).toMatch(/locked/);
  });

  it("gives every contract error a user can trigger its own text", () => {
    const fallback = explainError(new BaseError("unknown"));
    const names = ["RoundExpired", "TicketLimitExceeded", "InsufficientBonanza"] as const;
    for (const errorName of names) {
      const args = errorName === "RoundExpired" ? ([1n] as const) : undefined;
      const data = encodeErrorResult({ abi: lotteryAbi, errorName, args } as never);
      expect(explainError(reverted(data))).not.toBe(fallback);
    }
  });

  it("keeps short wallet messages and hides raw data", () => {
    expect(explainError(new Error("Switch your wallet to the Bonanza network."))).toMatch(/Switch/);
    expect(explainError(new Error("execution reverted 0xdeadbeef00"))).not.toMatch(/0xdead/);
  });
});
