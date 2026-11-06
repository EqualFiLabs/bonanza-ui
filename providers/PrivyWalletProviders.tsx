"use client";

import {
  getEmbeddedConnectedWallet,
  PrivyProvider,
  useCreateWallet,
  usePrivy,
  useSendTransaction,
  useWallets,
  type ConnectedWallet,
} from "@privy-io/react-auth";
import { createConfig, useSetActiveWallet, WagmiProvider } from "@privy-io/wagmi";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createWalletClient, custom, getAddress, type Address } from "viem";
import { useAccount } from "wagmi";

import { targetChain, walletEnvironment } from "@/lib/chain/client";
import { createWalletTransports } from "@/lib/wallet-config";
import {
  localForkTransactionParameters,
  localForkWalletProvider,
  verifyLocalForkWalletProvider,
} from "@/lib/wallet/local-fork";
import { recoverPrivyWallet } from "@/lib/wallet/reconnection";
import { selectActiveWallet } from "@/lib/wallet/selection";

import { WalletContext, type TransactionRequest, type WalletState } from "./wallet-context";

const wagmiConfig = createConfig({
  chains: walletEnvironment.supportedChains,
  transports: createWalletTransports(walletEnvironment),
});
const localFork = walletEnvironment.network === "anvil";

function connectedChainId(wallet: ConnectedWallet | undefined): number | null {
  if (!wallet?.chainId) return null;
  const parsed = Number(wallet.chainId.replace(/^eip155:/, ""));
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function WalletBridge({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, error: privyError, login, logout } = usePrivy();
  const { ready: walletsReady, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { sendTransaction: sendEmbeddedTransaction } = useSendTransaction();
  const wagmiAccount = useAccount();
  const { setActiveWallet } = useSetActiveWallet();
  const [busyAction, setBusyAction] = useState<WalletState["busyAction"]>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [waitingForEmbedded, setWaitingForEmbedded] = useState(false);

  const embeddedWallet = getEmbeddedConnectedWallet(wallets);
  const selectedWallet = selectActiveWallet(wallets, wagmiAccount.address);
  const address = selectedWallet ? getAddress(selectedWallet.address) : null;
  const walletKind = selectedWallet
    ? selectedWallet.walletClientType === "privy" || selectedWallet.walletClientType === "privy-v2"
      ? "embedded"
      : "external"
    : null;
  const chainId = connectedChainId(selectedWallet);

  useEffect(() => {
    if (!waitingForEmbedded || !authenticated || !embeddedWallet) return;
    let cancelled = false;
    void setActiveWallet(embeddedWallet)
      .then(() => {
        if (!cancelled) setWaitingForEmbedded(false);
      })
      .catch(() => {
        if (cancelled) return;
        setWaitingForEmbedded(false);
        setActionError("The embedded wallet could not be activated.");
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, embeddedWallet, setActiveWallet, waitingForEmbedded]);

  const runAction = useCallback(
    async (action: NonNullable<WalletState["busyAction"]>, operation: () => Promise<void>) => {
      setActionError(null);
      setBusyAction(action);
      try {
        await operation();
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "The wallet request failed.");
      } finally {
        setBusyAction(null);
      }
    },
    []
  );

  const sendTransaction = useCallback(
    async (request: TransactionRequest) => {
      if (!selectedWallet || !address) throw new Error("Connect a wallet before continuing.");
      if (address !== getAddress(request.wallet)) {
        throw new Error("The transaction was prepared for a different wallet.");
      }
      if (chainId !== targetChain.id) {
        throw new Error("Switch your wallet to the Bonanza network.");
      }

      const provider = await selectedWallet.getEthereumProvider();
      if (localFork) await verifyLocalForkWalletProvider(provider);

      if (walletKind === "embedded") {
        const localParameters = localFork
          ? await localForkTransactionParameters(request.wallet, walletEnvironment.anvilRpcUrl)
          : {};
        const result = await sendEmbeddedTransaction(
          {
            from: request.wallet,
            to: request.to,
            data: request.data,
            value: request.value,
            chainId: targetChain.id,
            ...localParameters,
          },
          {
            address,
            uiOptions: {
              showWalletUIs: true,
              description: request.action,
              buttonText: "Confirm",
              transactionInfo: {
                title: "Transaction details",
                action: request.action,
                contractInfo: { name: "Bonanza" },
              },
              successHeader: `${request.action} submitted`,
              successDescription: "The app will wait for onchain confirmation before continuing.",
              isCancellable: true,
            },
          }
        );
        return result.hash;
      }

      const client = createWalletClient({
        account: request.wallet,
        chain: targetChain,
        transport: custom(
          localFork ? localForkWalletProvider(provider, walletEnvironment.anvilRpcUrl) : provider
        ),
      });
      return client.sendTransaction({
        account: request.wallet,
        chain: targetChain,
        to: request.to,
        data: request.data,
        value: request.value,
      });
    },
    [address, chainId, selectedWallet, sendEmbeddedTransaction, walletKind]
  );

  let status: WalletState["status"] = "loading";
  if (privyError) status = "error";
  else if (ready && !authenticated) status = "signed-out";
  else if (ready && authenticated && walletsReady && !selectedWallet) status = "wallet-missing";
  else if (ready && authenticated && walletsReady && selectedWallet) status = "ready";

  const value = useMemo<WalletState>(
    () => ({
      status,
      address: address as Address | null,
      walletKind,
      networkName: targetChain.name,
      isTargetChain: chainId === targetChain.id,
      error: actionError ?? privyError?.message ?? null,
      busyAction,
      login: () => login({ loginMethods: ["email", "wallet"] }),
      logout: () => void logout(),
      createWallet: () =>
        runAction("create", async () => {
          await recoverPrivyWallet({
            embeddedWallet,
            authenticated,
            activateEmbedded: setActiveWallet,
            logout,
            selectEmbedded: () => undefined,
            restoreLocalConnection: () => undefined,
            waitForEmbeddedWallet: () => setWaitingForEmbedded(true),
            openEmailLogin: () => login({ loginMethods: ["email"] }),
          });
          if (authenticated && !embeddedWallet) await createWallet();
        }),
      switchNetwork: () =>
        runAction("switch", async () => {
          if (!selectedWallet) throw new Error("Connect a wallet before switching networks.");
          await selectedWallet.switchChain(targetChain.id);
        }),
      sendTransaction,
    }),
    [
      actionError,
      address,
      authenticated,
      busyAction,
      chainId,
      createWallet,
      embeddedWallet,
      login,
      logout,
      privyError,
      runAction,
      selectedWallet,
      sendTransaction,
      setActiveWallet,
      status,
      walletKind,
    ]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function PrivyWalletProviders({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={walletEnvironment.appId!}
      clientId={walletEnvironment.clientId ?? undefined}
      config={{
        loginMethods: ["wallet", "email"],
        supportedChains: [...walletEnvironment.privySupportedChains],
        defaultChain: walletEnvironment.privyDefaultChain,
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          showWalletUIs: true,
          extendedCalldataDecoding: true,
        },
        appearance: {
          theme: "dark",
          accentColor: "#f2b632",
          logo: "/icon.svg",
          walletChainType: "ethereum-only",
        },
      }}
    >
      <WagmiProvider config={wagmiConfig}>
        <WalletBridge>{children}</WalletBridge>
      </WagmiProvider>
    </PrivyProvider>
  );
}
