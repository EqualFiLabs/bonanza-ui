"use client";

import { createContext, useContext } from "react";
import type { Address, Hex } from "viem";

export type WalletRuntimeStatus =
  "unconfigured" | "loading" | "signed-out" | "wallet-missing" | "ready" | "error";

export type WalletKind = "embedded" | "external" | "fork" | null;

export type TransactionRequest = Readonly<{
  wallet: Address;
  to: Address;
  data: Hex;
  value?: bigint;
  action: string;
}>;

export type WalletState = Readonly<{
  status: WalletRuntimeStatus;
  address: Address | null;
  walletKind: WalletKind;
  networkName: string;
  isTargetChain: boolean;
  error: string | null;
  busyAction: "connect" | "create" | "switch" | "disconnect" | null;
  login: () => void;
  logout: () => void;
  createWallet: () => Promise<void>;
  switchNetwork: () => Promise<void>;
  sendTransaction: (request: TransactionRequest) => Promise<Hex>;
}>;

const unavailable = async () => undefined;

export const defaultWalletState: WalletState = {
  status: "unconfigured",
  address: null,
  walletKind: null,
  networkName: "Robinhood Chain",
  isTargetChain: false,
  error: null,
  busyAction: null,
  login: () => undefined,
  logout: () => undefined,
  createWallet: unavailable,
  switchNetwork: unavailable,
  sendTransaction: async () => {
    throw new Error("Wallet sign-in isn't configured for this build.");
  },
};

export const WalletContext = createContext<WalletState>(defaultWalletState);

export function useWalletState(): WalletState {
  return useContext(WalletContext);
}
