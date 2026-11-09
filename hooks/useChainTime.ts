"use client";

import { useSyncExternalStore } from "react";

let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => listeners.forEach((notify) => notify()), 1_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

function wallClockSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

/**
 * Countdowns follow chain time, projected forward from the last block read. Locks and deadlines are
 * enforced against block timestamps, which on a fork sit well behind the wall clock.
 */
export function useChainTime(blockTimestamp: bigint, observedAtMs: number): bigint {
  const wallClock = useSyncExternalStore(subscribe, wallClockSeconds, () => 0);
  const elapsed = Math.max(wallClock - Math.floor(observedAtMs / 1_000), 0);
  return blockTimestamp + BigInt(elapsed);
}
