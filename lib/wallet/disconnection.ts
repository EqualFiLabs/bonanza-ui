type Provider = Readonly<{
  request: (request: { method: string; params?: unknown[] }) => Promise<unknown>;
}>;

export type DisconnectableWallet = Readonly<{
  walletClientType: string;
  connectorType: string;
  getEthereumProvider: () => Promise<Provider>;
  disconnect: () => void;
}>;

// Wallets without revocation can ignore the request rather than reject it.
export const REVOKE_TIMEOUT_MS = 1_000;

function isEmbedded(wallet: DisconnectableWallet): boolean {
  return wallet.walletClientType === "privy" || wallet.walletClientType === "privy-v2";
}

async function revokeAccess(wallet: DisconnectableWallet): Promise<void> {
  const provider = await wallet.getEthereumProvider();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, REVOKE_TIMEOUT_MS);
  });
  try {
    await Promise.race([
      provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Privy's logout ends the session but leaves external wallets connected, and its wagmi bridge then
 * reconnects the most recent one. Signing out disconnects every wallet first, so the next sign-in
 * starts from the wallet picker and can use a different wallet.
 */
export async function signOutEverywhere({
  wallets,
  disconnectConnectors,
  logout,
}: {
  wallets: readonly DisconnectableWallet[];
  disconnectConnectors: () => Promise<void>;
  logout: () => Promise<void>;
}): Promise<void> {
  // Each wallet settles on its own, so one that fails can't keep the user signed in.
  await Promise.allSettled(
    wallets
      .filter((wallet) => !isEmbedded(wallet))
      .map(async (wallet) => {
        // MetaMask and other injected wallets can't be disconnected by the app, but most drop the
        // site's access when asked, so the next connection asks which account to use.
        await revokeAccess(wallet).catch(() => undefined);
        // Privy only warns for injected wallets. WalletConnect and Coinbase sessions do close.
        if (wallet.connectorType !== "injected") wallet.disconnect();
      })
  );
  // Marks every wagmi connector disconnected, which stops the bridge reconnecting the last one.
  await disconnectConnectors().catch(() => undefined);
  await logout();
}
