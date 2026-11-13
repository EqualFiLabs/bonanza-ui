import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import {
  createPublicClient,
  encodeFunctionData,
  erc20Abi,
  http,
  numberToHex,
  parseAbi,
  parseEther,
  parseGwei,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

import { fetchBeacon } from "@/lib/chain/drand";
import { lotteryAbi } from "@/lib/contracts/generated/lottery";

// Every flow here drives the real Lottery, Statics position contracts, Operator Router and the live
// drand registry on a Robinhood Mainnet fork. Results are checked onchain, not only on screen.

const deployment = JSON.parse(readFileSync(resolve(".local/fork/deployment.json"), "utf8"));
const client = createPublicClient({
  transport: http(`http://127.0.0.1:${process.env.BONANZA_FORK_PORT ?? 8860}`),
});
const lottery = { address: deployment.lottery as Address, abi: lotteryAbi };
const wallet: Address = deployment.actors.dave;
const alice: Address = deployment.actors.alice;
const weth: Address = deployment.weth;
const statics: Address = deployment.staticsToken;

const balanceOf = (token: Address, owner: Address = wallet) =>
  client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner] });

async function positionId(): Promise<bigint> {
  const [ids] = await client.readContract({
    address: deployment.positionNFT,
    abi: [
      {
        type: "function",
        name: "positionsOfOwner",
        stateMutability: "view",
        inputs: [
          { name: "owner", type: "address" },
          { name: "cursor", type: "uint256" },
          { name: "limit", type: "uint256" },
        ],
        outputs: [
          { name: "page", type: "uint256[]" },
          { name: "next", type: "uint256" },
        ],
      },
    ],
    functionName: "positionsOfOwner",
    args: [wallet, 0n, 10n],
  });
  return ids[0];
}

const account = async () =>
  client.readContract({ ...lottery, functionName: "bonanzaAccount", args: [await positionId()] });

const channel = (page: Page, text: string | RegExp) =>
  page.locator(".ch", { hasText: text }).first();
const panel = (page: Page) => page.getByRole("complementary", { name: "Round action" });

async function openTools(page: Page) {
  if (!(await page.locator(".tools").evaluate((element) => element.hasAttribute("open")))) {
    await page.locator(".tools summary").click();
  }
}

async function goTo(page: Page, label: string) {
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: label }).click();
}

const BLOCK_SECONDS = 2;
const rpc = (method: string, params: unknown[] = []) =>
  client.request({ method: method as never, params: params as never });

/** Sends from an unlocked fork account. Priority fees put it ahead of others in the same block. */
async function sendAs(from: Address, to: Address, data: Hex, value = 0n, priority = false) {
  const fees = priority
    ? {
        maxPriorityFeePerGas: numberToHex(parseGwei("50")),
        maxFeePerGas: numberToHex(parseGwei("200")),
      }
    : {};
  return (await rpc("eth_sendTransaction", [
    { from, to, data, value: numberToHex(value), ...fees },
  ])) as Hex;
}

async function confirmedAs(from: Address, to: Address, data: Hex, value = 0n) {
  const hash = await sendAs(from, to, data, value);
  const receipt = await client.waitForTransactionReceipt({ hash, pollingInterval: 100 });
  expect(receipt.status).toBe("success");
}

/** Holds the fork's blocks while `act` runs, so everything it sends lands in one block. */
async function inOneBlock(act: () => Promise<void>) {
  await rpc("evm_setIntervalMining", [0]);
  try {
    await act();
    await rpc("evm_mine");
  } finally {
    await rpc("evm_setIntervalMining", [BLOCK_SECONDS]);
  }
}

type Frame = Record<string, string>;

/**
 * Records every distinct state of the named regions until the returned function stops it. Polls
 * can change the screen between two assertions, so these checks cover everything that was shown.
 * Text is kept in lower case, since some labels are styled in capitals.
 */
async function record(page: Page, regions: Frame): Promise<() => Promise<Frame[]>> {
  await page.evaluate((selectors) => {
    const frames: Record<string, string>[] = [];
    let last = "";
    const capture = () => {
      const frame = Object.fromEntries(
        Object.entries(selectors).map(([name, selector]) => [
          name,
          [...document.querySelectorAll<HTMLElement>(selector)]
            .map((element) => element.innerText.replace(/\s+/g, " ").trim().toLowerCase())
            .join(" | "),
        ])
      );
      const text = JSON.stringify(frame);
      if (text !== last) {
        last = text;
        frames.push(frame);
      }
    };
    capture();
    const observer = new MutationObserver(capture);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    Object.assign(window, { recording: { frames, stop: () => observer.disconnect() } });
  }, regions);
  return () =>
    page.evaluate(() => {
      const { recording } = window as unknown as {
        recording: { frames: Record<string, string>[]; stop: () => void };
      };
      recording.stop();
      return recording.frames;
    });
}

const amount = (text: string, label: string) =>
  Number(new RegExp(`${label} ([\\d,]+\\.\\d+)`, "i").exec(text)![1].replaceAll(",", ""));

const stageTitle = (page: Page) => page.locator('[aria-label="Selected round"] .eyebrow');

test.describe.serial("real contracts on a mainnet fork", () => {
  let page: Page;
  const failures: string[] = [];

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    page = await context.newPage();
    page.on("pageerror", (error) => failures.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") failures.push(`console: ${message.text()}`);
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "On air" })).toBeVisible({ timeout: 120_000 });
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("reads seeded rounds from the chain", async () => {
    await expect(channel(page, "Deadline draw ready")).toContainText("7 / 20");
    await expect(channel(page, "Ready to draw")).toContainText("40 / 40");
    await expect(channel(page, "Drawn")).toContainText("30 / 30");
    const round = await client.readContract({ ...lottery, functionName: "round", args: [1n] });
    expect(round.status).toBe(3);
    await expect(channel(page, "0.0100 WETH")).toContainText("to the winner so far");
  });

  test("connects, creates a position, approves exactly and buys", async () => {
    await channel(page, "0.0100 WETH").click();
    await panel(page).getByRole("button", { name: "Connect wallet" }).click();
    await panel(page).getByRole("button", { name: "Create a position" }).click();
    const approve = panel(page).getByRole("button", { name: "Approve 0.0500 WETH" });
    await expect(approve).toBeVisible();
    expect(await positionId()).toBeGreaterThan(0n);

    const before = await balanceOf(weth);
    await approve.click();
    const buy = panel(page).getByRole("button", { name: "Buy 5 tickets" });
    await expect(buy).toBeVisible();
    expect(
      await client.readContract({
        address: weth,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet, lottery.address],
      })
    ).toBe(parseEther("0.05"));

    const stop = await record(page, {
      balance: '[aria-label="Round action"] .stub-balance',
      held: ".stage-foot",
      action: '[aria-label="Round action"] .btn',
      toast: ".toasts",
    });
    await buy.click();
    await expect(page.getByText("Bought 5 tickets")).toBeVisible();
    const frames = await stop();
    for (const frame of frames) {
      // The purchase appears all at once, and the button stays on it until it's done.
      if (frame.balance !== frames[0].balance) expect(frame.held).toContain("#0113–#0117");
      if (!frame.toast.includes("bought")) expect(frame.action).not.toMatch(/^approve/);
    }
    expect(before - (await balanceOf(weth))).toBe(parseEther("0.05"));
    expect((await account()).balance).toBe(parseEther("500"));
    await expect(page.getByText(/You hold/)).toContainText("#0113–#0117");

    const shown = await stageTitle(page).textContent();
    await goTo(page, "My tickets");
    await expect(page.locator(".trow")).toContainText("#0113–#0117");
    await goTo(page, "Rounds");
    await expect(page.getByRole("heading", { name: "On air" })).toBeVisible();
    await expect(stageTitle(page)).toHaveText(shown!);
  });

  test("explains a rejected wallet request beside the action", async () => {
    await channel(page, "0.0100 WETH").click();
    await openTools(page);
    await page.getByLabel("Reject next wallet request").check();
    await panel(page).getByRole("button", { name: "Max 25" }).click();
    await panel(page)
      .getByRole("button", { name: /Approve/ })
      .click();
    await expect(panel(page).getByRole("alert")).toHaveText(
      "You rejected the request in your wallet. Nothing was spent."
    );
    await expect(panel(page).getByRole("button", { name: /Approve/ })).toBeEnabled();

    // The error stays with its own round and its own page.
    await channel(page, "Ready to open").click();
    await expect(panel(page).getByRole("button", { name: /^Approve/ })).toBeVisible();
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
    await goTo(page, "My tickets");
    await goTo(page, "Rounds");
    await channel(page, "0.0100 WETH").click();
    await expect(panel(page).getByRole("button", { name: /Approve/ })).toBeEnabled();
    await expect(panel(page).getByRole("alert")).toHaveCount(0);
  });

  test("draws a sold-out round with a genuine beacon and pays the tip", async () => {
    await channel(page, "Ready to draw").click();
    const round = await client.readContract({ ...lottery, functionName: "round", args: [2n] });
    expect(round.status).toBe(2);
    await panel(page)
      .getByRole("button", { name: /Draw round/ })
      .click();
    await expect(panel(page).getByText("Signal")).toBeVisible();
    await expect(page.getByText("Round 2 drawn. Your tip is in Claims.")).toBeVisible();
    await expect(panel(page).getByText("Check the math")).toBeVisible();

    const drawn = await client.readContract({ ...lottery, functionName: "round", args: [2n] });
    expect(drawn.status).toBe(3);
    expect(drawn.winningTicket).toBeLessThan(40);
    expect(drawn.winnerClaimable).toBe(parseEther("2000"));

    await goTo(page, "Claims");
    const tip = page.locator(".claim", { hasText: "Finalizer tips" });
    await expect(tip).toContainText("10.00 STATICS");
    const before = await balanceOf(statics);
    await tip.getByRole("button", { name: "Claim" }).click();
    await expect(page.getByText("Claimed 10.00 STATICS")).toBeVisible();
    expect((await balanceOf(statics)) - before).toBe(parseEther("10"));
    await goTo(page, "Rounds");
    await expect(page.getByRole("heading", { name: "On air" })).toBeVisible();
  });

  test("opens a round, sells it out alone, loses the draw race, wins and claims", async () => {
    await channel(page, /(^|[^\d,])5\.00 STATICS/).click();
    await panel(page).getByRole("button", { name: "Max 30" }).click();
    await panel(page).getByRole("button", { name: "Approve 150.00 STATICS" }).click();
    const stop = await record(page, {
      balance: '[aria-label="Round action"] .stub-balance',
      held: ".stage-foot",
    });
    await panel(page).getByRole("button", { name: "Open round · buy 30 tickets" }).click();
    await expect(page.getByText("Bought 30 tickets")).toBeVisible();
    const opened = await stop();
    for (const frame of opened) {
      // The new round never shows as paid for without the tickets bought.
      if (frame.balance !== opened[0].balance) expect(frame.held).toContain("#0001–#0030");
    }
    await expect(page.getByText(/You hold/)).toContainText("#0001–#0030");

    const roundId = await client.readContract({ ...lottery, functionName: "latestRoundId" });
    const sold = await client.readContract({ ...lottery, functionName: "round", args: [roundId] });
    expect(sold.status).toBe(2);
    expect(sold.soldTickets).toBe(30);

    const draw = panel(page).getByRole("button", { name: /Draw round/ });
    if (!(await draw.isVisible())) {
      await openTools(page);
      await expect(draw.or(page.getByRole("button", { name: /Skip round/ }).first())).toBeVisible();
      if (!(await draw.isVisible())) {
        await page
          .getByRole("button", { name: /Skip round/ })
          .first()
          .click();
      }
    }
    // Another player posts the beacon too, and both draws land in one block with theirs first.
    await expect(draw).toBeVisible();
    const { signature } = await fetchBeacon(sold.drandRound);
    await inOneBlock(async () => {
      const settle = encodeFunctionData({
        abi: lotteryAbi,
        functionName: "settleRound",
        args: [roundId, signature],
      });
      await sendAs(alice, lottery.address, settle, 0n, true);
      await draw.click();
      await expect(panel(page).getByRole("button", { name: "Posting beacon…" })).toBeVisible();
    });
    await expect(page.getByText(`Someone else drew round ${roundId} first.`)).toBeVisible();
    await expect(panel(page).getByRole("heading", { name: "You won" })).toBeVisible();

    const won = await client.readContract({ ...lottery, functionName: "round", args: [roundId] });
    expect(won.winner.toLowerCase()).toBe(wallet.toLowerCase());
    expect(won.winnerClaimable).toBe(parseEther("75"));
    const aliceTip = await client.readContract({
      ...lottery,
      functionName: "finalizerCredit",
      args: [statics, alice],
    });
    expect(aliceTip).toBeGreaterThan(0n);

    // The claim link moves within the app, so the wallet session carries over.
    await page.evaluate(() => Object.assign(window, { sameDocument: true }));
    await panel(page).getByRole("link", { name: "Claim 75.00 STATICS" }).click();
    const claim = page.locator(".claim", { hasText: "Winner" });
    await expect(claim).toContainText("75.00 STATICS");
    expect(await page.evaluate(() => "sameDocument" in window)).toBe(true);

    await claim.getByRole("button", { name: "Send elsewhere" }).click();
    await claim.getByLabel("Receiver").fill("someone.eth");
    await expect(claim.getByRole("alert")).toContainText("ENS names aren't resolved");
    await expect(claim.getByRole("button", { name: "Claim", exact: true })).toBeDisabled();
    const receiver: Address = deployment.actors.recipient;
    await claim.getByLabel("Receiver").fill(receiver);
    const before = await balanceOf(statics, receiver);
    const stopRows = await record(page, { rows: ".claim", toast: ".toasts" });
    await claim.getByRole("button", { name: "Claim", exact: true }).click();
    await expect(page.getByText("Claimed 75.00 STATICS")).toBeVisible();
    for (const frame of await stopRows()) {
      // The row leaves together with its confirmation, not before it.
      if (!frame.rows.includes("winner")) expect(frame.toast).toContain("claimed 75.00 statics");
    }
    expect((await balanceOf(statics, receiver)) - before).toBe(parseEther("75"));
    await expect(page.locator(".claim", { hasText: "Winner" })).toHaveCount(0);
  });

  test("stakes, boosts, earns revenue, then unstakes after the lock", async () => {
    await goTo(page, "BONANZA");
    await expect(page.getByRole("heading", { name: "Stake" })).toBeVisible();
    await page.getByLabel("BONANZA amount").fill("100");
    await expect(page.getByText("in 24h 00m")).toBeVisible();
    const stop = await record(page, {
      stake: '[aria-label="Stake"] .stats',
      reserve: '[aria-label="Reward reserve"]',
    });
    await page.getByRole("button", { name: "Stake 100.00 BONANZA" }).click();
    await expect(page.getByText("Staked 100.00 BONANZA")).toBeVisible();
    const frames = await stop();
    const others = (frame: Frame) =>
      amount(frame.reserve, "total staked weight") - amount(frame.stake, "revenue weight");
    for (const frame of frames) {
      // Everyone else's weight can't move when this position stakes, so no frame mixes two blocks.
      expect(Math.abs(others(frame) - others(frames[0]))).toBeLessThanOrEqual(0.01);
      expect(amount(frame.stake, "share of stakers")).toBeLessThanOrEqual(100);
    }
    expect((await account()).staked).toBe(parseEther("100"));

    await page.getByRole("button", { name: "Unstake", exact: true }).click();
    await expect(page.getByRole("button", { name: "Still locked" })).toBeDisabled();
    await page.getByRole("button", { name: "Stake", exact: true }).click();

    await page.getByLabel("Operator ID").fill(deployment.operatorId);
    await page.getByRole("button", { name: "Register Operator #3" }).click();
    await expect(page.getByText("Operator #3 registered")).toBeVisible();
    const boosted = await account();
    expect(boosted.registered).toBe(true);
    expect(boosted.weight).toBeGreaterThan(boosted.staked);

    await page.getByRole("button", { name: "Checkpoint" }).click();
    await expect(page.getByText("Checkpoint booked")).toBeVisible();

    // A purchase by this staker books real revenue to its weight.
    await goTo(page, "Rounds");
    await channel(page, "25.00 STATICS").click();
    await panel(page)
      .getByRole("button", { name: /Approve/ })
      .click();
    await panel(page)
      .getByRole("button", { name: /^Buy \d+ tickets?$/ })
      .click();
    await expect(page.getByText(/^Bought \d+ tickets?$/)).toBeVisible();

    await goTo(page, "BONANZA");
    const revenue = page.getByRole("region", { name: "Revenue" });
    const statement = revenue.locator(".listrow", { hasText: "STATICS" });
    const before = await balanceOf(statics);
    await statement.getByRole("button", { name: "Claim" }).click();
    await expect(page.getByText(/^Claimed .* STATICS$/)).toBeVisible();
    expect(await balanceOf(statics)).toBeGreaterThan(before);

    await openTools(page);
    await page.getByRole("button", { name: "Skip 24 hours" }).click();
    await expect(page.getByText("Unlocked. You can unstake at any time.")).toBeVisible();
    await page.getByRole("button", { name: "Unstake", exact: true }).click();
    await page.getByLabel("BONANZA amount").fill("40");
    await page.getByRole("button", { name: "Unstake 40.00 BONANZA" }).click();
    await expect(page.getByText("Unstaked 40.00 BONANZA")).toBeVisible();
    expect((await account()).staked).toBe(parseEther("60"));

    await page.getByRole("button", { name: "Remove boost" }).click();
    await expect(page.getByText("Boost removed")).toBeVisible();
    const cleared = await account();
    expect(cleared.registered).toBe(false);
    expect(cleared.weight).toBe(cleared.staked);
  });

  test("keeps exits open while paused", async () => {
    await openTools(page);
    await page.getByLabel("Pause the protocol").click();
    await expect(page.getByText("New exposure is paused.")).toBeVisible();
    await page.getByLabel("BONANZA amount").fill("1");
    await expect(page.getByRole("button", { name: "Unstake 1.00 BONANZA" })).toBeEnabled();
    await page.getByRole("button", { name: "Stake", exact: true }).click();
    await expect(page.getByRole("button", { name: "Staking is paused" })).toBeDisabled();

    await goTo(page, "Rounds");
    await channel(page, "0.0100 WETH").click();
    await expect(panel(page).getByRole("button", { name: "Buying is paused" })).toBeDisabled();
    await channel(page, "Deadline draw ready").click();
    await expect(panel(page).getByRole("button", { name: /Draw round/ })).toBeEnabled();

    await page.getByLabel("Pause the protocol").click();
    await expect(page.getByText("New exposure is paused.")).toHaveCount(0);
  });

  test("runs a deadline draw on the default round, reveals it and stays on it", async () => {
    // A reload keeps the wallet signed in and starts again from the default round.
    await page.reload();
    await expect(page.getByRole("heading", { name: "On air" })).toBeVisible();
    await expect(stageTitle(page)).toContainText("Round 3");
    const stop = await record(page, {
      stage: '[aria-label="Selected round"] .eyebrow',
      panel: '[aria-label="Round action"] .eyebrow',
    });
    await panel(page)
      .getByRole("button", { name: /Draw round/ })
      .click();
    await expect(page.getByText(/^Round 3 drawn\./)).toBeVisible();
    await expect(panel(page).getByText("Check the math")).toBeVisible();
    const frames = await stop();
    expect(frames.every((frame) => frame.stage.includes("round 3"))).toBe(true);
    const steps = frames
      .map((frame) => frame.panel.split(" · ")[0])
      .filter((step, index, all) => step !== all[index - 1]);
    expect(steps).toEqual(["deadline draw ready", "drawing", "drawn"]);
    const round = await client.readContract({ ...lottery, functionName: "round", args: [3n] });
    expect(round.status).toBe(3);
    expect(round.soldTickets).toBe(7);
    expect(round.winnerClaimable).toBe(parseUnits("0.0035", 18));
  });

  test("opens conversions when governance enables them", async () => {
    await goTo(page, "BONANZA");
    const conversions = page.getByRole("region", { name: "Conversions" });
    await expect(conversions.getByText("CLOSED")).toHaveCount(2);
    await expect(page.getByText(/no market price/)).toBeVisible();

    await openTools(page);
    await page.getByLabel("Open unwrap").click();
    await expect(page.getByText(/Redeems 1:1/)).toBeVisible();
    await conversions.getByLabel("BONANZA to unwrap").fill("10");
    const before = await balanceOf(statics);
    await conversions.getByRole("button", { name: "Unwrap 10.00 BONANZA" }).click();
    await expect(page.getByText("Unwrapped 10.00 BONANZA")).toBeVisible();
    expect((await balanceOf(statics)) - before).toBe(parseEther("10"));

    await page.getByLabel("Open public wrap").click();
    await conversions.getByLabel("STATICS to wrap").fill("25");
    await conversions.getByRole("button", { name: "Approve 25.00 STATICS" }).click();
    const balance = (await account()).balance;
    await conversions.getByRole("button", { name: "Wrap 25.00 STATICS" }).click();
    await expect(page.getByText("Wrapped 25.00 STATICS")).toBeVisible();
    expect((await account()).balance - balance).toBe(parseEther("25"));
  });

  test("explains a round someone else opened first and keeps the ticket count", async () => {
    const deposit = encodeFunctionData({
      abi: parseAbi(["function deposit() payable"]),
      functionName: "deposit",
    });
    await confirmedAs(alice, weth, deposit, parseEther("1"));
    await confirmedAs(
      alice,
      weth,
      encodeFunctionData({
        abi: erc20Abi,
        functionName: "approve",
        args: [lottery.address, parseEther("1")],
      })
    );

    await goTo(page, "Rounds");
    await channel(page, "0.0010 WETH").click();
    await expect(stageTitle(page)).toHaveText("Ch 04");
    await panel(page).getByLabel("Number of tickets").fill("6");
    await panel(page).getByRole("button", { name: "Approve 0.0060 WETH" }).click();
    const open = panel(page).getByRole("button", { name: "Open round · buy 6 tickets" });
    await expect(open).toBeVisible();

    await inOneBlock(async () => {
      const openRound = encodeFunctionData({
        abi: lotteryAbi,
        functionName: "openRound",
        args: [4n, 8],
      });
      await sendAs(alice, lottery.address, openRound, 0n, true);
      await open.click();
      await expect(panel(page).getByRole("button", { name: "Buying…" })).toBeVisible();
    });
    await expect(panel(page).getByRole("alert")).toHaveText(
      "Someone just opened this round. Buy into it instead. Only gas was spent."
    );
    await expect(page.locator(".stage-foot")).toContainText("8 of 20 sold");
    await expect(panel(page).getByLabel("Number of tickets")).toHaveValue("6");
    await expect(panel(page).getByRole("button", { name: "Buy 6 tickets" })).toBeEnabled();
  });

  test("fits small screens and passes an accessibility scan", async () => {
    for (const route of ["Rounds", "My tickets", "BONANZA", "Claims"]) {
      await goTo(page, route);
      await page.waitForTimeout(500);
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth
        );
        expect(overflow, `${route} at ${width}px`).toBeLessThanOrEqual(0);
      }
      await page.setViewportSize({ width: 1440, height: 1000 });
      const { violations } = await new AxeBuilder({ page }).analyze();
      expect(
        violations.map((violation) => `${route}: ${violation.id}`),
        "accessibility"
      ).toEqual([]);
    }
  });

  test("raises no browser errors across the session", () => {
    expect(failures).toEqual([]);
  });
});
