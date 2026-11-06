"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { encodeFunctionData, type Abi, type Address, type TransactionReceipt } from "viem";

import { publicClient } from "@/lib/chain/client";
import { explainError } from "@/lib/protocol/errors";

import { ACCOUNT_QUERY, PROTOCOL_QUERY } from "./protocol-context";
import { useToast } from "./toast-context";
import { useWalletState } from "./wallet-context";

export type ContractCall = Readonly<{
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}>;

export type TxOptions = Readonly<{
  action: string;
  pending?: string;
  success?: string;
  onReceipt?: (receipt: TransactionReceipt) => void;
}>;

type TxState = Readonly<{
  busy: Readonly<Record<string, string>>;
  errors: Readonly<Record<string, string>>;
  run: (key: string, build: () => Promise<ContractCall>, options: TxOptions) => Promise<boolean>;
}>;

const TxContext = createContext<TxState>({
  busy: {},
  errors: {},
  run: async () => false,
});

export function useTx(): TxState {
  return useContext(TxContext);
}

export function TxProvider({ children }: { children: React.ReactNode }) {
  const { address, sendTransaction } = useWalletState();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<Readonly<Record<string, string>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const running = useRef(new Set<string>());

  const mark = useCallback((key: string, label: string | null) => {
    setBusy((current) => {
      const next = { ...current };
      if (label) next[key] = label;
      else delete next[key];
      return next;
    });
  }, []);

  const run = useCallback<TxState["run"]>(
    async (key, build, options) => {
      if (running.current.has(key) || !address) return false;
      running.current.add(key);
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      mark(key, "Preparing…");
      try {
        const call = await build();
        const { abi, functionName, args, value } = call;
        // A simulated revert names the real reason before the wallet is ever opened.
        await publicClient.simulateContract({
          account: address,
          address: call.address,
          abi: abi as Abi,
          functionName,
          args: args as unknown[],
          value,
        });
        mark(key, "Confirm in wallet…");
        const hash = await sendTransaction({
          wallet: address,
          to: call.address,
          data: encodeFunctionData({ abi: abi as Abi, functionName, args: args as unknown[] }),
          value,
          action: options.action,
        });
        mark(key, options.pending ?? "Confirming…");
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") {
          throw new Error("The transaction reverted onchain. Only gas was spent.");
        }
        options.onReceipt?.(receipt);
        // The button stays pending until the screen shows the confirmed state.
        await Promise.all([
          queryClient.refetchQueries({ queryKey: [PROTOCOL_QUERY] }),
          queryClient.refetchQueries({ queryKey: [ACCOUNT_QUERY] }),
        ]);
        if (options.success) toast(options.success);
        return true;
      } catch (error) {
        setErrors((current) => ({ ...current, [key]: explainError(error) }));
        return false;
      } finally {
        running.current.delete(key);
        mark(key, null);
      }
    },
    [address, mark, queryClient, sendTransaction, toast]
  );

  const value = useMemo(() => ({ busy, errors, run }), [busy, errors, run]);
  return <TxContext.Provider value={value}>{children}</TxContext.Provider>;
}
