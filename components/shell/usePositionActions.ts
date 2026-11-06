"use client";

import { useCallback } from "react";

import { positionAbi } from "@/lib/contracts/abis";
import { useProtocol } from "@/providers/protocol-context";
import { useTx } from "@/providers/tx-context";
import { useWalletState } from "@/providers/wallet-context";

export const CREATE_POSITION_KEY = "create-position";

export function useCreatePosition(): () => void {
  const { protocol, account } = useProtocol();
  const { address } = useWalletState();
  const { run } = useTx();
  return useCallback(() => {
    void run(
      CREATE_POSITION_KEY,
      async () => ({
        address: protocol.bindings.positionNFT,
        abi: positionAbi,
        functionName: "createPosition",
        args: [address],
        value: account?.positionCreationFee ?? 0n,
      }),
      { action: "Create position", success: "Position created" }
    );
  }, [account?.positionCreationFee, address, protocol.bindings.positionNFT, run]);
}
