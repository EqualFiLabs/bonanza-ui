import { getAddress, type Address } from "viem";

export type Deployment = Readonly<{
  chainId: number;
  lottery: Address;
  startBlock: bigint;
}>;

/** Accounts and tokens the local fork tools need. Only present on a local fork. */
export type ForkDetails = Readonly<{
  authority: Address;
  staticsToken: Address;
  weth: Address;
  staticsHolder: Address;
  operatorId: bigint;
  testWallet: Address;
}>;

// Reviewed public deployments, keyed by chain ID. A network with no entry shows that Bonanza isn't
// deployed there, so a public build can never point at an unreviewed address.
const PUBLISHED: Readonly<Record<number, Deployment>> = {};

type LocalManifest = Record<string, unknown> & { actors?: Record<string, unknown> };

function parseLocalManifest(value: string | undefined): LocalManifest | null {
  if (!value?.trim()) return null;
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("NEXT_PUBLIC_BONANZA_LOCAL_DEPLOYMENT must be a JSON object.");
  }
  return parsed as LocalManifest;
}

export function resolveDeployment(
  chainId: number,
  appEnvironment: string,
  localManifest: string | undefined
): Deployment | null {
  const local = parseLocalManifest(localManifest);
  // A local manifest is accepted only in development, so no public build can load one.
  if (local && appEnvironment === "development" && Number(local.chainId) === chainId) {
    return {
      chainId,
      lottery: getAddress(String(local.lottery)),
      startBlock: BigInt(String(local.startBlock)),
    };
  }
  return PUBLISHED[chainId] ?? null;
}

export function resolveForkDetails(
  appEnvironment: string,
  localManifest: string | undefined
): ForkDetails | null {
  const local = parseLocalManifest(localManifest);
  if (!local || appEnvironment !== "development") return null;
  return {
    authority: getAddress(String(local.authority)),
    staticsToken: getAddress(String(local.staticsToken)),
    weth: getAddress(String(local.weth)),
    staticsHolder: getAddress(String(local.staticsHolder)),
    operatorId: BigInt(String(local.operatorId)),
    testWallet: getAddress(String(local.actors?.dave)),
  };
}
