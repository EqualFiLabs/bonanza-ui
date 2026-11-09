"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { encodeFunctionData, type Abi, type Address, type TransactionReceipt } from "viem";

import { publicClient } from "@/lib/chain/client";
import { explainError, rejectedByUser, revertReason } from "@/lib/protocol/errors";

import { PROTOCOL_QUERY } from "./protocol-context";
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

type Simulation = Readonly<{
  account: Address;
  address: Address;
  abi: Abi;
  functionName: string;
  args: unknown[];
  value: bigint | undefined;
}>;

/** Replays a reverted call in its own block, where it fails again and names its reason. */
async function revertedOnchain(simulation: Simulation, blockNumber: bigint): Promise<Error> {
  try {
    await publicClient.simulateContract({ ...simulation, blockNumber });
  } catch (error) {
    const reason = revertReason(error);
    if (reason) return new Error(`${reason} Only gas was spent.`);
  }
  return new Error("The transaction reverted onchain. Only gas was spent.");
}

export function TxProvider({ children }: { children: React.ReactNode }) {
  const { address, sendTransaction } = useWalletState();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<Readonly<Record<string, string>>>({});
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const running = useRef(new Set<string>());

  // An error belongs to the page it happened on.
  const pathname = usePathname();
  const [errorsPath, setErrorsPath] = useState(pathname);
  if (pathname !== errorsPath) {
    setErrorsPath(pathname);
    setErrors({});
  }

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
        const simulation = {
          account: address,
          address: call.address,
          abi: abi as Abi,
          functionName,
          args: args as unknown[],
          value,
        };
        // A simulated revert names the real reason before the wallet is ever opened.
        await publicClient.simulateContract(simulation);
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
          throw await revertedOnchain(simulation, receipt.blockNumber);
        }
        options.onReceipt?.(receipt);
        // The button stays pending until the screen shows the confirmed state.
        await queryClient.refetchQueries({ queryKey: [PROTOCOL_QUERY] });
        if (options.success) toast(options.success);
        return true;
      } catch (error) {
        // Most failures mean the chain moved, such as another player drawing first. The screen
        // catches up before the message appears beside it.
        if (!rejectedByUser(error)) {
          await queryClient.refetchQueries({ queryKey: [PROTOCOL_QUERY] });
        }
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
