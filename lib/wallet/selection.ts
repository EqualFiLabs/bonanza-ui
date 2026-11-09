import { getEmbeddedConnectedWallet, type ConnectedWallet } from "@privy-io/react-auth";

/**
 * Keep the app and Wagmi on the same connected wallet after a user explicitly chooses one. A stale
 * Wagmi address is ignored so an available embedded wallet still recovers after an external wallet
 * disappears.
 */
export function selectActiveWallet(
  wallets: ConnectedWallet[],
  activeAddress: string | undefined
): ConnectedWallet | undefined {
  const activeWallet = activeAddress
    ? wallets.find((wallet) => wallet.address.toLowerCase() === activeAddress.toLowerCase())
    : undefined;
  if (activeWallet) return activeWallet;
  return getEmbeddedConnectedWallet(wallets) ?? wallets[0];
}
