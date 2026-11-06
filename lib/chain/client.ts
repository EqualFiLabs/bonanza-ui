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

export const publicClient: PublicClient = createPublicClient({
  chain: targetChain,
  transport: createWalletTransports(walletEnvironment)[targetChain.id],
});
