import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { resolve } from "node:path";

import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  maxUint256,
  stringToBytes,
  zeroAddress,
} from "viem";

import {
  artifact,
  baselinePath,
  contractsDirectory,
  deploymentPath,
  forkBlock,
  forkDirectory,
  forkPort,
  forkRpcUrl,
  pidPath,
  robinhoodMainnetChainId,
} from "./shared.mjs";

const DRAND_REGISTRY = "0xB1a30ff19243Af135003E541769dD520DA1acC2B";
const QUICKNET = "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";
const ACCOUNT_MODULE = keccak256(stringToBytes("statics.lottery.fiddy.account.v1"));
const TIMELOCK_DELAY = 86_400n;
const TEST_OPERATOR_ID = 3n;
const WAD = 10n ** 18n;

const chain = {
  id: robinhoodMainnetChainId,
  name: "Robinhood mainnet fork",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [forkRpcUrl] } },
};
const transport = http(forkRpcUrl, { retryCount: 0, timeout: 120_000 });
const publicClient = createPublicClient({ chain, transport });
const walletClient = createWalletClient({ chain, transport });
const testClient = createTestClient({ chain, transport, mode: "anvil" });

function step(message) {
  console.log(`[fork] ${message}`);
}

function portOpen(port) {
  return new Promise((done) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      done(true);
    });
    socket.once("error", () => done(false));
  });
}

async function startAnvil() {
  const upstream = process.env.ROBINHOOD_MAINNET?.trim();
  if (!upstream) throw new Error("ROBINHOOD_MAINNET must be set to a Robinhood Chain RPC.");
  if (await portOpen(forkPort)) {
    throw new Error(`Port ${forkPort} is in use. Stop it or set BONANZA_FORK_PORT.`);
  }
  mkdirSync(forkDirectory, { recursive: true });
  // Output is discarded because Anvil's errors can repeat the private upstream URL.
  const log = openSync("/dev/null", "w");
  const child = spawn(
    "anvil",
    [
      "--silent",
      "--fork-url",
      upstream,
      "--host",
      "127.0.0.1",
      "--port",
      String(forkPort),
      "--fork-block-number",
      forkBlock.toString(),
      "--chain-id",
      String(robinhoodMainnetChainId),
      "--hardfork",
      "osaka",
      "--accounts",
      "12",
      "--balance",
      "10000",
      "--gas-limit",
      "30000000",
      "--code-size-limit",
      "60000",
    ],
    { detached: true, stdio: ["ignore", log, log] }
  );
  closeSync(log);
  writeFileSync(pidPath, String(child.pid));
  child.unref();
  for (let attempt = 0; attempt < 240; attempt += 1) {
    if (await portOpen(forkPort)) return;
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("Anvil did not start.");
}

async function confirmed(hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 180_000 });
  if (receipt.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  return receipt;
}

async function send(account, contract, functionName, args = [], value = 0n) {
  const data = encodeFunctionData({ abi: contract.abi, functionName, args });
  const hash = await walletClient.sendTransaction({
    account,
    to: contract.address,
    data,
    value,
    gas: 12_000_000n,
  });
  return confirmed(hash);
}

function read(contract, functionName, args = []) {
  return publicClient.readContract({
    address: contract.address,
    abi: contract.abi,
    functionName,
    args,
  });
}

async function deploy(account, group, name, args = []) {
  const { abi, bytecode } = artifact(group, name);
  const hash = await walletClient.deployContract({
    account,
    abi,
    bytecode: bytecode.object,
    args,
    gas: 15_000_000n,
  });
  const receipt = await confirmed(hash);
  return { address: receipt.contractAddress, abi };
}

function combinedAbi(group, names) {
  const seen = new Set();
  return names
    .flatMap((name) => artifact(group, name).abi)
    .filter((entry) => {
      if (entry.type === "constructor") return false;
      const inputs = (entry.inputs ?? []).map((input) => input.type).join();
      const key = `${entry.type}:${entry.name}:${inputs}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function deployPositions(owner, guardian, treasury, statics) {
  const names = [
    "DiamondCutFacet",
    "DiamondLoupeFacet",
    "OwnershipFacet",
    "PositionNFTFacet",
    "ExternalModuleFacet",
  ];
  const cuts = [];
  for (const name of names) {
    const facet = await deploy(owner, "statics", name);
    // ERC-165 belongs to the loupe; the other ERC-721 selectors stay on PositionNFT.
    const selectors = Object.entries(artifact("statics", name).methodIdentifiers)
      .filter(([signature]) => name !== "PositionNFTFacet" || !signature.startsWith("supportsI"))
      .map(([, selector]) => `0x${selector}`);
    cuts.push({ facetAddress: facet.address, action: 0, functionSelectors: selectors });
  }
  const init = await deploy(owner, "statics", "StaticsProtocolInit");
  const data = encodeFunctionData({
    abi: init.abi,
    functionName: "genesisInitialize",
    args: [cuts, guardian, treasury, statics, 0n, 0n, 0n, 5n],
  });
  const diamond = await deploy(owner, "statics", "StaticsDiamond", [
    owner,
    zeroAddress,
    init.address,
    data,
  ]);
  return { address: diamond.address, abi: combinedAbi("statics", names) };
}

async function deployRouter(owner, dependencies) {
  const timelock = await deploy(owner, "router", "OperatorFeeRouterTimelock", [[owner], [owner]]);
  const router = await deploy(owner, "router", "OperatorFeeRouter", [
    dependencies.operators,
    dependencies.activation,
    dependencies.vault,
    timelock.address,
  ]);
  const last = await read(router, "LAST_OPERATOR_ID");
  for (;;) {
    const next = await read(router, "nextOperatorId");
    if (next > last) break;
    await send(owner, router, "bootstrapOperators", [100n]);
    if ((next - 1n) % 1000n === 0n) step(`Router bootstrap ${next - 1n}/${last}`);
  }
  await send(owner, router, "finalizeBootstrap");
  return { router, timelock };
}

async function deployLottery(owner, guardian, treasury, router, bindings) {
  const names = [
    "DiamondCutFacet",
    "DiamondLoupeFacet",
    "GovernanceFacet",
    "LotteryFacet",
    "SettlementFacet",
    "ClaimsFacet",
    "RevenueFacet",
    "LotteryViewFacet",
    "FiddyTokenFacet",
    "FiddyStakingFacet",
    "FiddyViewFacet",
  ];
  const facets = {};
  for (const name of names) facets[name] = await deploy(owner, "lottery", name);
  const diamond = await deploy(owner, "lottery", "StaticsLotteryDiamond", [
    owner,
    facets.DiamondCutFacet.address,
  ]);
  const lottery = { address: diamond.address, abi: combinedAbi("lottery", names) };
  const cuts = names
    .filter((name) => name !== "DiamondCutFacet")
    .map((name) => ({
      facetAddress: facets[name].address,
      action: 0,
      functionSelectors: Object.values(artifact("lottery", name).methodIdentifiers).map(
        (selector) => `0x${selector}`
      ),
    }));
  const init = await deploy(owner, "lottery", "LotteryInit");
  // Initialization needs one configuration. This one never opens a round.
  const placeholder = config(bindings.underlying, { price: WAD, tickets: 2, operator: 0 });
  const params = {
    authority: owner,
    guardian,
    treasuryRecipient: treasury,
    maxActiveRounds: 100,
    integration: { drandRegistry: DRAND_REGISTRY, operatorFeeRouter: router.address },
    lotteryConfigs: [placeholder],
  };
  const data = encodeFunctionData({
    abi: init.abi,
    functionName: "initializeWithFiddy",
    args: [params, bindings],
  });
  const receipt = await send(owner, lottery, "diamondCut", [cuts, init.address, data]);
  await send(owner, lottery, "setLotteryConfigEnabled", [1n, false]);
  return { lottery, startBlock: receipt.blockNumber };
}

function config(
  paymentToken,
  { price, tickets, duration = 3_600, max = 0, tip = 0n, operator = 4_000, recipient, share = 0 }
) {
  return {
    paymentToken,
    ticketPrice: price,
    ticketCount: tickets,
    salesDuration: duration,
    randomnessDelay: 6,
    maxTicketsPerPurchase: max,
    winnerBps: 5_000,
    operatorProtocolBps: operator,
    recipientBps: share,
    recipient: recipient ?? zeroAddress,
    finalizerTip: tip,
  };
}

async function registerRouterAssets(owner, router, timelock, assets) {
  const zero = `0x${"00".repeat(32)}`;
  const calls = assets.map((asset) => ({
    data: encodeFunctionData({
      abi: router.abi,
      functionName: "registerRewardAsset",
      args: [asset],
    }),
    salt: keccak256(stringToBytes(asset)),
  }));
  for (const { data, salt } of calls) {
    await send(owner, timelock, "schedule", [router.address, 0n, data, zero, salt, TIMELOCK_DELAY]);
  }
  await testClient.increaseTime({ seconds: Number(TIMELOCK_DELAY) + 1 });
  await testClient.mine({ blocks: 1 });
  for (const { data, salt } of calls) {
    await send(owner, timelock, "execute", [router.address, 0n, data, zero, salt]);
  }
}

async function advanceTo(timestamp) {
  const { timestamp: now } = await publicClient.getBlock();
  if (now < timestamp) {
    await testClient.increaseTime({ seconds: Number(timestamp - now) });
    await testClient.mine({ blocks: 1 });
  }
}

async function drawRound(lottery, registry, roundId, finalizer) {
  const round = await read(lottery, "round", [roundId]);
  await advanceTo((await read(registry, "roundTime", [round.drandRound])) + 1n);
  const response = await fetch(`https://api.drand.sh/${QUICKNET}/public/${round.drandRound}`);
  if (!response.ok) throw new Error("A Quicknet relay did not return the committed beacon.");
  const { signature } = await response.json();
  await send(finalizer, lottery, "settleRound", [roundId, `0x${signature}`]);
}

async function seedFunds(context) {
  const { actors, statics, weth, lottery, operators, activation, manifest } = context;
  const candidates = [
    manifest.roles.treasury,
    manifest.contracts.treasuryVesting.address,
    manifest.contracts.genesisVault.address,
  ];
  let holder;
  for (const candidate of candidates) {
    if ((await read(statics, "balanceOf", [candidate])) >= 400_000n * WAD) {
      holder = candidate;
      break;
    }
  }
  if (!holder) throw new Error("No manifest-backed holder has enough STATICS.");
  await testClient.impersonateAccount({ address: holder });
  await testClient.setBalance({ address: holder, value: 100n * WAD });

  for (const actor of [actors.alice, actors.bob, actors.carol, actors.dave]) {
    await send(holder, statics, "transfer", [actor, 60_000n * WAD]);
    await send(actor, weth, "deposit", [], 50n * WAD);
  }
  for (const actor of [actors.alice, actors.bob, actors.carol]) {
    await send(actor, statics, "approve", [lottery.address, maxUint256]);
    await send(actor, weth, "approve", [lottery.address, maxUint256]);
  }

  // A real Operator: moved from its live owner and activated through the real registry.
  const owner = await read(operators, "ownerOf", [TEST_OPERATOR_ID]);
  await testClient.impersonateAccount({ address: owner });
  await testClient.setBalance({ address: owner, value: 100n * WAD });
  await send(owner, operators, "transferFrom", [owner, actors.dave, TEST_OPERATOR_ID]);
  await send(actors.dave, statics, "approve", [activation.address, maxUint256]);
  if ((await read(activation, "tierOf", [TEST_OPERATOR_ID])) === 0) {
    await send(actors.dave, activation, "activate", [TEST_OPERATOR_ID, 1]);
  }
  await send(actors.dave, statics, "approve", [activation.address, 0n]);

  await send(actors.alice, statics, "approve", [lottery.address, maxUint256]);
  await send(holder, statics, "transfer", [actors.alice, 200_000n * WAD]);
  await send(actors.alice, lottery, "fundFiddyReserve", [200_000n * WAD]);
  return holder;
}

async function createRound(authority, lottery, lotteryConfig, rewards) {
  if (rewards) {
    await send(authority, lottery, "createRewardLotteryConfig", [lotteryConfig, rewards]);
  } else {
    await send(authority, lottery, "createLotteryConfig", [lotteryConfig]);
  }
  const version = await read(lottery, "latestLotteryConfigVersion");
  await send(authority, lottery, "setLotteryConfigEnabled", [version, true]);
  return version;
}

async function seedRounds(context) {
  const { actors, statics, weth, lottery, registry, authority, positions } = context;
  const { alice, bob, carol, recipient } = actors;
  const open = async (actor, version, quantity) => {
    await send(actor, lottery, "openRoundForPosition", [version, quantity, positions[actor]]);
    return read(lottery, "latestRoundId");
  };
  const buy = (actor, roundId, quantity) =>
    send(actor, lottery, "buyTicketsForPosition", [roundId, quantity, positions[actor]]);
  const rewards = (units) => ({
    unitsPerTicket: units * WAD,
    stakerProtocolBps: 2_500,
    participation: true,
  });
  const milli = 10n ** 15n;

  step("Seeding a drawn round");
  const drawn = await createRound(
    authority,
    lottery,
    config(statics.address, { price: 50n * WAD, tickets: 30, max: 15, tip: 5n * WAD }),
    rewards(18n)
  );
  const firstRound = await open(alice, drawn, 15);
  await buy(bob, firstRound, 15);
  await drawRound(lottery, registry, firstRound, carol);

  step("Staking the participation rewards");
  await send(alice, lottery, "stakeFiddy", [positions[alice], 200n * WAD]);
  await send(bob, lottery, "stakeFiddy", [positions[bob], 120n * WAD]);

  step("Seeding rounds waiting for a draw");
  const soldOut = await createRound(
    authority,
    lottery,
    config(statics.address, { price: 100n * WAD, tickets: 40, max: 20, tip: 10n * WAD }),
    rewards(40n)
  );
  const soldOutRound = await open(alice, soldOut, 20);
  await buy(bob, soldOutRound, 15);
  await buy(carol, soldOutRound, 5);

  const deadline = await createRound(
    authority,
    lottery,
    config(weth.address, { price: milli, tickets: 20, duration: 1_800, max: 10, tip: milli / 5n })
  );
  await send(carol, lottery, "openRound", [deadline, 7]);
  await testClient.increaseTime({ seconds: 1_900 });
  await testClient.mine({ blocks: 1 });

  step("Seeding open rounds");
  const main = await createRound(
    authority,
    lottery,
    config(weth.address, {
      price: 10n * milli,
      tickets: 400,
      duration: 3 * 86_400,
      max: 25,
      tip: 2n * milli,
    }),
    rewards(100n)
  );
  const mainRound = await open(alice, main, 25);
  await buy(bob, mainRound, 25);
  await buy(carol, mainRound, 25);
  await buy(alice, mainRound, 25);
  await buy(bob, mainRound, 12);

  const fund = await createRound(
    authority,
    lottery,
    config(statics.address, {
      price: 25n * WAD,
      tickets: 2_000,
      duration: 6 * 86_400,
      max: 50,
      tip: 5n * WAD,
      share: 500,
      recipient,
    }),
    rewards(12n)
  );
  const fundRound = await open(bob, fund, 50);
  await buy(carol, fundRound, 50);
  await buy(alice, fundRound, 41);

  await createRound(
    authority,
    lottery,
    config(statics.address, {
      price: 5n * WAD,
      tickets: 30,
      duration: 6 * 3_600,
      max: 30,
      tip: WAD,
    }),
    rewards(5n)
  );
}

async function main() {
  const contracts = contractsDirectory();
  const manifest = JSON.parse(
    readFileSync(resolve(contracts, "lib/statics/deployments/robinhood-mainnet-genesis.json"))
  );
  step("Starting the pinned Robinhood Mainnet fork");
  await startAnvil();
  const [owner, alice, bob, carol, treasury, guardian, dave, recipient] = await testClient.request({
    method: "eth_accounts",
  });
  const actors = { alice, bob, carol, dave, recipient };
  // Public test keys can carry delegated code on the source chain; clear only those accounts.
  for (const actor of [owner, alice, bob, carol, treasury, guardian, dave, recipient]) {
    await testClient.setCode({ address: actor, bytecode: "0x" });
  }
  const dependencies = {
    statics: getAddress(manifest.contracts.staticsToken.address),
    weth: getAddress(manifest.externalDependencies.weth.address),
    operators: getAddress(manifest.contracts.operatorsNft.address),
    activation: getAddress(manifest.contracts.activationRegistry.address),
    vault: getAddress(manifest.contracts.genesisVault.address),
  };
  for (const address of [...Object.values(dependencies), DRAND_REGISTRY]) {
    const code = await publicClient.getCode({ address });
    if (!code || code === "0x") throw new Error(`No live code at ${address}.`);
  }

  step("Deploying Statics position contracts");
  const position = await deployPositions(owner, guardian, treasury, dependencies.statics);
  step("Deploying the Operator Fee Router");
  const { router, timelock } = await deployRouter(owner, dependencies);
  step("Deploying the Lottery Diamond");
  const { lottery, startBlock } = await deployLottery(owner, guardian, treasury, router, {
    underlying: dependencies.statics,
    positionNFT: position.address,
    operators: dependencies.operators,
    registry: dependencies.activation,
  });
  step("Registering payment tokens through the Router timelock");
  await registerRouterAssets(owner, router, timelock, [dependencies.statics, dependencies.weth]);
  await send(owner, position, "setExternalModule", [lottery.address, ACCOUNT_MODULE, true]);
  await send(owner, lottery, "setFiddyBoostsEnabled", [true]);

  const statics = artifactContract("lottery", "FiddyTokenFacet", dependencies.statics);
  const weth = {
    address: dependencies.weth,
    abi: [
      ...statics.abi,
      {
        type: "function",
        name: "deposit",
        inputs: [],
        outputs: [],
        stateMutability: "payable",
      },
    ],
  };
  const operators = artifactContract("statics", "StaticsGenesis", dependencies.operators);
  const activation = artifactContract(
    "statics",
    "GenesisActivationRegistry",
    dependencies.activation
  );
  const registry = artifactContract("lottery", "IEqualFiDrandRegistry", DRAND_REGISTRY);

  step("Funding test accounts");
  const context = {
    actors,
    statics,
    weth,
    lottery,
    operators,
    activation,
    registry,
    manifest,
    authority: owner,
    positions: {},
  };
  const staticsHolder = await seedFunds(context);
  for (const actor of [alice, bob, carol]) {
    await send(actor, position, "createPosition", [actor]);
    const [ids] = await read(position, "positionsOfOwner", [actor, 0n, 1n]);
    context.positions[actor] = ids[0];
  }
  await seedRounds(context);

  // Blocks now arrive on a timer, so the clock moves and countdowns behave as on a live chain.
  await testClient.setIntervalMining({ interval: 2 });

  const { timestamp } = await publicClient.getBlock();
  const deployment = {
    chainId: robinhoodMainnetChainId,
    forkBlock: forkBlock.toString(),
    lottery: lottery.address,
    startBlock: startBlock.toString(),
    positionNFT: position.address,
    router: router.address,
    authority: owner,
    guardian,
    staticsToken: dependencies.statics,
    weth: dependencies.weth,
    staticsHolder,
    operatorId: TEST_OPERATOR_ID.toString(),
    actors,
    positions: Object.fromEntries(
      Object.entries(context.positions).map(([actor, id]) => [actor, id.toString()])
    ),
    seededAt: timestamp.toString(),
  };
  writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);
  // fork:reset returns here, which is far quicker than deploying again.
  const snapshot = await testClient.snapshot();
  writeFileSync(baselinePath, JSON.stringify({ snapshot, timestamp: timestamp.toString() }));
  step(`Ready. Lottery ${lottery.address}, test wallet ${dave}, local RPC ${forkRpcUrl}`);
}

function artifactContract(group, name, address) {
  return { address, abi: artifact(group, name).abi };
}

if (existsSync(deploymentPath)) {
  throw new Error("A local fork is already recorded. Run npm run fork:down first.");
}
await main().catch((error) => {
  // Viem errors can echo request details, so only the first line is printed.
  console.error(`[fork] Failed: ${String(error?.shortMessage ?? error?.message).split("\n")[0]}`);
  process.exit(1);
});
