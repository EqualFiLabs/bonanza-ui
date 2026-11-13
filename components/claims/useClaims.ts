"use client";

import { useMemo } from "react";
import type { Address } from "viem";

import { deployment } from "@/lib/chain/client";
import { lotteryAbi } from "@/lib/contracts/generated/lottery";
import { tokenOf } from "@/lib/protocol/rounds";
import type { Token } from "@/lib/protocol/types";
import { useOptionalProtocol } from "@/providers/protocol-context";
import type { ContractCall } from "@/providers/tx-context";

export type Claim = Readonly<{
  key: string;
  kind: string;
  source: string;
  token: Token;
  amount: bigint;
  call: (receiver: Address) => ContractCall;
}>;

/** Everything the wallet can collect now. Each row is its own transaction, so none blocks another. */
export function useClaims(): readonly Claim[] {
  const state = useOptionalProtocol();
  const protocol = state?.protocol;
  const account = state?.account;
  return useMemo(() => {
    if (!protocol || !account) return [];
    const lottery = { address: deployment!.lottery, abi: lotteryAbi };
    const claims: Claim[] = [];
    const owner = account.owner.toLowerCase();

    for (const round of [...protocol.rounds, ...account.olderRounds]) {
      const token = tokenOf(protocol, round.config.paymentToken);
      if (round.winnerClaimable > 0n && round.winner.toLowerCase() === owner) {
        claims.push({
          key: `winner-${round.id}`,
          kind: "Winner",
          source: `Round ${round.id}`,
          token,
          amount: round.winnerClaimable,
          call: (receiver) => ({
            ...lottery,
            functionName: "claimWinner",
            args: [round.id, receiver],
          }),
        });
      }
      if (round.recipientClaimable > 0n && round.config.recipient.toLowerCase() === owner) {
        claims.push({
          key: `recipient-${round.id}`,
          kind: "Recipient",
          source: `Round ${round.id}`,
          token,
          amount: round.recipientClaimable,
          call: (receiver) => ({
            ...lottery,
            functionName: "claimRecipientRevenue",
            args: [round.id, receiver],
          }),
        });
      }
    }

    for (const [address, amount] of Object.entries(account.finalizerCredits)) {
      if (amount === 0n) continue;
      const asset = address as Address;
      claims.push({
        key: `tip-${asset}`,
        kind: "Finalizer tips",
        source: "Rounds you drew",
        token: tokenOf(protocol, asset),
        amount,
        call: (receiver) => ({
          ...lottery,
          functionName: "claimFinalizerTips",
          args: [asset, receiver],
        }),
      });
    }

    for (const position of account.positions) {
      for (const [address, amount] of Object.entries(position.revenue)) {
        if (amount === 0n) continue;
        const asset = address as Address;
        claims.push({
          key: `revenue-${position.id}-${asset}`,
          kind: "Staker revenue",
          source: `Position #${position.id}`,
          token: tokenOf(protocol, asset),
          amount,
          call: (receiver) => ({
            ...lottery,
            functionName: "claimBonanzaRevenue",
            args: [position.id, asset, receiver],
          }),
        });
      }
    }
    return claims;
  }, [account, protocol]);
}
