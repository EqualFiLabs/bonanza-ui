import type { Address, PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

import { loadTickets } from "@/lib/protocol/load";

const owner: Address = "0x00000000000000000000000000000000000000a1";

function log(id: number, roundId: bigint, start: number, end: number) {
  return {
    transactionHash: `0x${id}`,
    logIndex: 0,
    args: { roundId, startTicket: start, endExclusive: end },
  };
}

function setup(logs: ReturnType<typeof log>[], startBlock = 1_000n) {
  const lottery = `0x${String(startBlock).padStart(40, "0")}` as Address;
  const getLogs = vi.fn(async () => logs);
  return {
    getLogs,
    client: { getLogs } as unknown as PublicClient,
    deployment: { chainId: 1, lottery, startBlock },
  };
}

describe("loadTickets", () => {
  it("scans from the deployment on first load", async () => {
    const { client, deployment, getLogs } = setup([log(1, 7n, 0, 5)]);
    const tickets = await loadTickets(client, deployment, owner, 1_200n);
    expect(tickets).toEqual({ "7": [{ start: 0, end: 5 }] });
    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 1_000n, toBlock: 1_200n })
    );
  });

  it("pages long ranges so public RPC limits aren't exceeded", async () => {
    const { client, deployment, getLogs } = setup([], 2_000n);
    await loadTickets(client, deployment, owner, 122_000n);
    expect(getLogs).toHaveBeenCalledTimes(3);
  });

  it("only rescans a short overlap on later polls", async () => {
    const { client, deployment, getLogs } = setup([], 3_000n);
    await loadTickets(client, deployment, owner, 5_000n);
    getLogs.mockClear();
    await loadTickets(client, deployment, owner, 5_010n);
    expect(getLogs).toHaveBeenCalledTimes(1);
    expect(getLogs).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 4_937n, toBlock: 5_010n })
    );
  });

  it("counts a purchase seen twice in the overlap once", async () => {
    const { client, deployment } = setup([log(2, 3n, 0, 2)], 4_000n);
    await loadTickets(client, deployment, owner, 4_100n);
    const tickets = await loadTickets(client, deployment, owner, 4_101n);
    expect(tickets["3"]).toHaveLength(1);
  });

  it("starts again when the chain moves backwards", async () => {
    const { client, deployment, getLogs } = setup([], 6_000n);
    await loadTickets(client, deployment, owner, 7_000n);
    getLogs.mockClear();
    await loadTickets(client, deployment, owner, 6_500n);
    expect(getLogs).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 6_000n }));
  });
});
