import { erc20Abi, parseAbiItem, type Address, type PublicClient } from "viem";

import { drandRegistryAbi, positionAbi } from "@/lib/contracts/abis";
import { lotteryAbi } from "@/lib/contracts/generated/lottery";
import type { Deployment } from "@/deployments/manifests";

import type { TicketRange } from "./format";
import type {
  AccountSnapshot,
  Channel,
  ProtocolSnapshot,
  Round,
  Snapshot,
  StakingAccount,
  Token,
} from "./types";

// The app lists a bounded window of rounds. A wallet's own older rounds are found from its purchase
// logs and loaded with its account, so a prize stays claimable however old it gets.
const ROUND_WINDOW = 48n;
const POSITION_PAGE = 100n;
const LOG_PAGE = 50_000n;
const LOG_OVERLAP = 64n;

const ticketsPurchased = parseAbiItem(
  "event TicketsPurchased(uint256 indexed roundId, address indexed buyer, address indexed paymentToken, uint32 startTicket, uint32 quantity, uint32 endExclusive, uint256 amount)"
);

function range(from: bigint, to: bigint): bigint[] {
  const values: bigint[] = [];
  for (let value = from; value <= to; value += 1n) values.push(value);
  return values;
}

const tokenCache = new Map<Address, Token>();

async function loadToken(client: PublicClient, address: Address, lottery: Address): Promise<Token> {
  const cached = tokenCache.get(address);
  if (cached) return cached;
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]);
  // The Lottery is itself the reward token, and the contract source still names it FIDDY.
  const token = { address, symbol: address === lottery ? "BONA" : symbol, decimals };
  tokenCache.set(address, token);
  return token;
}

async function loadRound(
  client: PublicClient,
  deployment: Deployment,
  drandRegistry: Address,
  id: bigint,
  blockNumber?: bigint
): Promise<Round> {
  const read = { address: deployment.lottery, abi: lotteryAbi, blockNumber } as const;
  const [round, rewards, stakerBooked] = await Promise.all([
    client.readContract({ ...read, functionName: "round", args: [id] }),
    client.readContract({ ...read, functionName: "fiddyRoundConfig", args: [id] }),
    client.readContract({ ...read, functionName: "fiddyRoundRevenue", args: [id] }),
  ]);
  const beaconAt = await client.readContract({
    address: drandRegistry,
    abi: drandRegistryAbi,
    functionName: "roundTime",
    args: [round.drandRound],
  });
  return { ...round, id, rewards, stakerBooked, beaconAt };
}

export async function loadProtocol(
  client: PublicClient,
  deployment: Deployment
): Promise<ProtocolSnapshot> {
  const lottery = { address: deployment.lottery, abi: lotteryAbi } as const;
  const block = await client.getBlock();
  const blockNumber = block.number;
  const read = { ...lottery, blockNumber };

  const [
    paused,
    latestRoundId,
    latestVersion,
    bindings,
    reserve,
    staking,
    revenueAssets,
    integration,
  ] = await Promise.all([
    client.readContract({ ...read, functionName: "paused" }),
    client.readContract({ ...read, functionName: "latestRoundId" }),
    client.readContract({ ...read, functionName: "latestLotteryConfigVersion" }),
    client.readContract({ ...read, functionName: "fiddyBindings" }),
    client.readContract({ ...read, functionName: "fiddyReserve" }),
    client.readContract({ ...read, functionName: "fiddyStaking" }),
    client.readContract({ ...read, functionName: "fiddyRevenueAssets" }),
    client.readContract({ ...read, functionName: "currentIntegration" }),
  ]);
  const drandRegistry = integration[0].drandRegistry;

  const channels: Channel[] = await Promise.all(
    range(1n, latestVersion).map(async (version) => {
      const [[config, enabled], rewards, activeRoundId] = await Promise.all([
        client.readContract({ ...read, functionName: "lotteryConfig", args: [version] }),
        client.readContract({ ...read, functionName: "fiddyConfig", args: [version] }),
        client.readContract({ ...read, functionName: "activeRoundForConfig", args: [version] }),
      ]);
      return { version, config, rewards, enabled, activeRoundId };
    })
  );

  const firstRound = latestRoundId > ROUND_WINDOW ? latestRoundId - ROUND_WINDOW + 1n : 1n;
  const rounds = await Promise.all(
    range(firstRound, latestRoundId).map((id) =>
      loadRound(client, deployment, drandRegistry, id, blockNumber)
    )
  );

  const addresses = new Set<Address>([bindings[0], ...revenueAssets]);
  for (const channel of channels) addresses.add(channel.config.paymentToken);
  for (const round of rounds) addresses.add(round.config.paymentToken);
  const tokens = Object.fromEntries(
    (
      await Promise.all(
        [...addresses].map((address) => loadToken(client, address, deployment.lottery))
      )
    ).map((token) => [token.address, token])
  );

  return {
    blockNumber,
    blockTimestamp: block.timestamp,
    observedAtMs: Date.now(),
    paused,
    bindings: {
      underlying: bindings[0],
      positionNFT: bindings[1],
      operators: bindings[2],
      registry: bindings[3],
    },
    drandRegistry,
    reserve: {
      inventory: reserve[0],
      backing: reserve[1],
      custody: reserve[2],
      wrapEnabled: reserve[3],
      unwrapEnabled: reserve[4],
      wrapCap: reserve[5],
      wrapOutstanding: reserve[6],
    },
    totalWeight: staking[0],
    boostsEnabled: staking[1],
    revenueAssets,
    channels,
    rounds,
    tokens,
  };
}

async function loadPositionIds(
  client: PublicClient,
  positionNFT: Address,
  owner: Address,
  blockNumber: bigint
): Promise<bigint[]> {
  const contract = { address: positionNFT, abi: positionAbi, blockNumber } as const;
  const count = await client.readContract({
    ...contract,
    functionName: "positionCount",
    args: [owner],
  });
  const ids: bigint[] = [];
  let cursor = 0n;
  while (cursor < count) {
    const [page, next] = await client.readContract({
      ...contract,
      functionName: "positionsOfOwner",
      args: [owner, cursor, POSITION_PAGE],
    });
    if (next <= cursor) throw new Error("The position index returned an invalid page.");
    ids.push(...page);
    cursor = next;
  }
  return ids;
}

type TicketScan = {
  nextBlock: bigint;
  seen: Set<string>;
  tickets: Record<string, TicketRange[]>;
};

const ticketScans = new Map<string, TicketScan>();

/**
 * Logs are read once and kept, since this runs on every poll. Each scan repeats a short overlap so
 * a shallow reorg can't hide a purchase, and a chain that moved backwards starts again.
 */
export async function loadTickets(
  client: PublicClient,
  deployment: Deployment,
  owner: Address,
  latest: bigint
): Promise<Record<string, TicketRange[]>> {
  const key = `${deployment.lottery}:${owner}`;
  let scan = ticketScans.get(key);
  if (!scan || latest + 1n < scan.nextBlock) {
    scan = { nextBlock: deployment.startBlock, seen: new Set(), tickets: {} };
    ticketScans.set(key, scan);
  }
  const overlapped = scan.nextBlock - LOG_OVERLAP;
  const start = overlapped > deployment.startBlock ? overlapped : deployment.startBlock;
  // Ranges are paged because public RPCs limit how many blocks one log query may span.
  for (let from = start; from <= latest; from += LOG_PAGE) {
    const to = from + LOG_PAGE - 1n < latest ? from + LOG_PAGE - 1n : latest;
    const logs = await client.getLogs({
      address: deployment.lottery,
      event: ticketsPurchased,
      args: { buyer: owner },
      fromBlock: from,
      toBlock: to,
    });
    for (const { args, transactionHash, logIndex } of logs) {
      const id = `${transactionHash}:${logIndex}`;
      if (scan.seen.has(id)) continue;
      scan.seen.add(id);
      const round = args.roundId!.toString();
      scan.tickets[round] = [
        ...(scan.tickets[round] ?? []),
        { start: args.startTicket!, end: args.endExclusive! },
      ];
    }
  }
  scan.nextBlock = latest + 1n;
  return { ...scan.tickets };
}

/**
 * Reads the wallet at the protocol snapshot's block. Mixing blocks would pair a new stake with the old
 * total weight, or a new balance with tickets not yet scanned.
 */
export async function loadAccount(
  client: PublicClient,
  deployment: Deployment,
  protocol: ProtocolSnapshot,
  owner: Address
): Promise<AccountSnapshot> {
  const { blockNumber } = protocol;
  const lottery = { address: deployment.lottery, abi: lotteryAbi, blockNumber } as const;
  const assets = Object.keys(protocol.tokens) as Address[];

  const [nativeBalance, positionCreationFee, ids, tickets, balances, allowances, credits] =
    await Promise.all([
      client.getBalance({ address: owner, blockNumber }),
      client.readContract({
        address: protocol.bindings.positionNFT,
        abi: positionAbi,
        functionName: "positionCreationFee",
        blockNumber,
      }),
      loadPositionIds(client, protocol.bindings.positionNFT, owner, blockNumber),
      loadTickets(client, deployment, owner, blockNumber),
      Promise.all(
        assets.map((address) =>
          client.readContract({
            address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [owner],
            blockNumber,
          })
        )
      ),
      Promise.all(
        assets.map((address) =>
          client.readContract({
            address,
            abi: erc20Abi,
            functionName: "allowance",
            args: [owner, deployment.lottery],
            blockNumber,
          })
        )
      ),
      Promise.all(
        assets.map((asset) =>
          client.readContract({
            ...lottery,
            functionName: "finalizerCredit",
            args: [asset, owner],
          })
        )
      ),
    ]);

  const listed = new Set(protocol.rounds.map((round) => round.id));
  const olderRounds = await Promise.all(
    Object.keys(tickets)
      .map(BigInt)
      .filter((id) => !listed.has(id))
      .map((id) => loadRound(client, deployment, protocol.drandRegistry, id, blockNumber))
  );

  const positions: StakingAccount[] = await Promise.all(
    ids.map(async (id) => {
      const [account, revenue] = await Promise.all([
        client.readContract({ ...lottery, functionName: "fiddyAccount", args: [id] }),
        Promise.all(
          protocol.revenueAssets.map((asset) =>
            client.readContract({
              ...lottery,
              functionName: "indexedFiddyRevenue",
              args: [id, asset],
            })
          )
        ),
      ]);
      return {
        id,
        balance: account.balance,
        staked: account.staked,
        weight: account.weight,
        operatorId: account.operatorId,
        multiplierBps: account.multiplierBps,
        stakeStart: account.stakeStart,
        registered: account.registered,
        revenue: Object.fromEntries(
          protocol.revenueAssets.map((asset, index) => [asset, revenue[index][0]])
        ),
      };
    })
  );

  const byAsset = (values: readonly bigint[]) =>
    Object.fromEntries(assets.map((asset, index) => [asset, values[index]]));

  return {
    owner,
    nativeBalance,
    positionCreationFee,
    balances: byAsset(balances),
    allowances: byAsset(allowances),
    positions,
    tickets,
    olderRounds,
    finalizerCredits: byAsset(credits),
  };
}

export async function loadSnapshot(
  client: PublicClient,
  deployment: Deployment,
  owner: Address | null
): Promise<Snapshot> {
  const protocol = await loadProtocol(client, deployment);
  const account = owner ? await loadAccount(client, deployment, protocol, owner) : null;
  return { protocol, account };
}
