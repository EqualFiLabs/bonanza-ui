import type { Hex } from "viem";

export const QUICKNET_CHAIN_HASH =
  "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

// A relay is untrusted transport: the registry verifies the BLS signature onchain.
export const DRAND_RELAYS = [
  "https://api.drand.sh",
  "https://api2.drand.sh",
  "https://api3.drand.sh",
  "https://drand.cloudflare.com",
] as const;

const SIGNATURE_PATTERN = /^[0-9a-f]{96}$/;

export type Beacon = Readonly<{ round: bigint; randomness: string; signature: Hex }>;

type BeaconResponse = { round?: unknown; randomness?: unknown; signature?: unknown };

function parseBeacon(body: BeaconResponse): Beacon | null {
  if (typeof body.round !== "number" || !Number.isSafeInteger(body.round)) return null;
  if (typeof body.randomness !== "string") return null;
  if (typeof body.signature !== "string" || !SIGNATURE_PATTERN.test(body.signature)) return null;
  return {
    round: BigInt(body.round),
    randomness: body.randomness,
    signature: `0x${body.signature}`,
  };
}

async function fetchFromRelays(path: string, signal?: AbortSignal): Promise<Beacon | null> {
  for (const relay of DRAND_RELAYS) {
    try {
      const response = await fetch(`${relay}/${QUICKNET_CHAIN_HASH}/public/${path}`, {
        cache: "no-store",
        signal,
      });
      if (!response.ok) continue;
      const beacon = parseBeacon((await response.json()) as BeaconResponse);
      if (beacon) return beacon;
    } catch (error) {
      if (signal?.aborted) throw error;
    }
  }
  return null;
}

export function fetchLatestBeacon(signal?: AbortSignal): Promise<Beacon | null> {
  return fetchFromRelays("latest", signal);
}

export async function fetchBeacon(round: bigint, signal?: AbortSignal): Promise<Beacon> {
  const beacon = await fetchFromRelays(round.toString(), signal);
  if (!beacon || beacon.round !== round) {
    throw new Error(
      `Beacon ${round.toString()} isn't available yet. Try again when a drand relay has it.`
    );
  }
  return beacon;
}
