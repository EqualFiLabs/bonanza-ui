import { createPublicClient, type PublicClient } from "viem";

import { resolveDeployment, resolveForkDetails } from "@/deployments/manifests";
import { createWalletTransports, readWalletEnvironment } from "@/lib/wallet-config";

const LOCAL_MANIFEST = process.env.NEXT_PUBLIC_BONANZA_LOCAL_DEPLOYMENT;

export const walletEnvironment = readWalletEnvironment();

export const targetChain = walletEnvironment.defaultChain;

export const deployment = resolveDeployment(
  targetChain.id,
  walletEnvironment.appEnvironment,
  LOCAL_MANIFEST
);

export const forkDetails =
  walletEnvironment.network === "anvil"
    ? resolveForkDetails(walletEnvironment.appEnvironment, LOCAL_MANIFEST)
    : null;

/** Signing with the fork's unlocked account needs both a development fork and an explicit flag. */
export const usesForkWallet =
  forkDetails !== null && process.env.NEXT_PUBLIC_BONANZA_FORK_WALLET === "1";

// Robinhood Chain makes a block about every 0.1 s. viem's default would check for a receipt every
// 4 s, so the app would learn of its own transaction after its regular poll had already shown it.
const RECEIPT_POLL_MS = 250;

export const publicClient: PublicClient = createPublicClient({
  chain: targetChain,
  pollingInterval: RECEIPT_POLL_MS,
  transport: createWalletTransports(walletEnvironment)[targetChain.id],
});
