import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createPublicClient, erc20Abi, http, parseEther, parseUnits, type Address } from "viem";

import { lotteryAbi } from "@/lib/contracts/generated/lottery";

// Every flow here drives the real Lottery, Statics position contracts, Operator Router and the live
// drand registry on a Robinhood Mainnet fork. Results are checked onchain, not only on screen.

const deployment = JSON.parse(readFileSync(resolve(".local/fork/deployment.json"), "utf8"));
const client = createPublicClient({
  transport: http(`http://127.0.0.1:${process.env.BONANZA_FORK_PORT ?? 8860}`),
});
const lottery = { address: deployment.lottery as Address, abi: lotteryAbi };
const wallet: Address = deployment.actors.dave;
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
  client.readContract({ ...lottery, functionName: "fiddyAccount", args: [await positionId()] });

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

    await buy.click();
    await expect(page.getByText("Bought 5 tickets")).toBeVisible();
    expect(before - (await balanceOf(weth))).toBe(parseEther("0.05"));
    expect((await account()).balance).toBe(parseEther("500"));
    await expect(page.getByText(/You hold/)).toContainText("#0113–#0117");

    await goTo(page, "My tickets");
    await expect(page.locator(".trow")).toContainText("#0113–#0117");
    await goTo(page, "Rounds");
    await expect(page.getByRole("heading", { name: "On air" })).toBeVisible();
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
  });

  test("draws a sold-out round with a genuine beacon and pays the tip", async () => {
    await channel(page, "Ready to draw").click();
    const round = await client.readContract({ ...lottery, functionName: "round", args: [2n] });
    expect(round.status).toBe(2);
    await panel(page)
      .getByRole("button", { name: /Draw round/ })
      .click();
    await expect(panel(page).getByText("Signal")).toBeVisible();
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

  test("opens a round, sells it out alone, wins and claims", async () => {
    await channel(page, /(^|[^\d,])5\.00 STATICS/).click();
    await panel(page).getByRole("button", { name: "Max 30" }).click();
    await panel(page).getByRole("button", { name: "Approve 150.00 STATICS" }).click();
    await panel(page).getByRole("button", { name: "Open round · buy 30 tickets" }).click();
    await expect(page.getByText("Bought 30 tickets")).toBeVisible();
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
    await draw.click();
    await expect(panel(page).getByRole("heading", { name: "You won" })).toBeVisible();

    const won = await client.readContract({ ...lottery, functionName: "round", args: [roundId] });
    expect(won.winner.toLowerCase()).toBe(wallet.toLowerCase());
    expect(won.winnerClaimable).toBe(parseEther("75"));

    await goTo(page, "Claims");
    const claim = page.locator(".claim", { hasText: "Winner" });
    await expect(claim).toContainText("75.00 STATICS");

    await claim.getByRole("button", { name: "Send elsewhere" }).click();
    await claim.getByLabel("Receiver").fill("someone.eth");
    await expect(claim.getByRole("alert")).toContainText("ENS names aren't resolved");
    await expect(claim.getByRole("button", { name: "Claim", exact: true })).toBeDisabled();
    const receiver: Address = deployment.actors.recipient;
    await claim.getByLabel("Receiver").fill(receiver);
    const before = await balanceOf(statics, receiver);
    await claim.getByRole("button", { name: "Claim", exact: true }).click();
    await expect(page.getByText("Claimed 75.00 STATICS")).toBeVisible();
    expect((await balanceOf(statics, receiver)) - before).toBe(parseEther("75"));
    await expect(page.locator(".claim", { hasText: "Winner" })).toHaveCount(0);
  });

  test("stakes, boosts, earns revenue, then unstakes after the lock", async () => {
    await goTo(page, "BONA");
    await expect(page.getByRole("heading", { name: "Stake" })).toBeVisible();
    await page.getByLabel("BONA amount").fill("100");
    await expect(page.getByText("in 24h 00m")).toBeVisible();
    await page.getByRole("button", { name: "Stake 100.00 BONA" }).click();
    await expect(page.getByText("Staked 100.00 BONA")).toBeVisible();
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

    await goTo(page, "BONA");
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
    await page.getByLabel("BONA amount").fill("40");
    await page.getByRole("button", { name: "Unstake 40.00 BONA" }).click();
    await expect(page.getByText("Unstaked 40.00 BONA")).toBeVisible();
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
    await page.getByLabel("BONA amount").fill("1");
    await expect(page.getByRole("button", { name: "Unstake 1.00 BONA" })).toBeEnabled();
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

  test("runs deadline draws for rounds that didn't sell out", async () => {
    await channel(page, "Deadline draw ready").click();
    await panel(page)
      .getByRole("button", { name: /Draw round/ })
      .click();
    await expect(panel(page).getByText("Check the math")).toBeVisible();
    const round = await client.readContract({ ...lottery, functionName: "round", args: [3n] });
    expect(round.status).toBe(3);
    expect(round.soldTickets).toBe(7);
    expect(round.winnerClaimable).toBe(parseUnits("0.0035", 18));
  });

  test("opens conversions when governance enables them", async () => {
    await goTo(page, "BONA");
    const conversions = page.getByRole("region", { name: "Conversions" });
    await expect(conversions.getByText("CLOSED")).toHaveCount(2);
    await expect(page.getByText(/no market price/)).toBeVisible();

    await openTools(page);
    await page.getByLabel("Open unwrap").click();
    await expect(page.getByText(/Redeems 1:1/)).toBeVisible();
    await conversions.getByLabel("BONA to unwrap").fill("10");
    const before = await balanceOf(statics);
    await conversions.getByRole("button", { name: "Unwrap 10.00 BONA" }).click();
    await expect(page.getByText("Unwrapped 10.00 BONA")).toBeVisible();
    expect((await balanceOf(statics)) - before).toBe(parseEther("10"));

    await page.getByLabel("Open public wrap").click();
    await conversions.getByLabel("STATICS to wrap").fill("25");
    await conversions.getByRole("button", { name: "Approve 25.00 STATICS" }).click();
    const balance = (await account()).balance;
    await conversions.getByRole("button", { name: "Wrap 25.00 STATICS" }).click();
    await expect(page.getByText("Wrapped 25.00 STATICS")).toBeVisible();
    expect((await account()).balance - balance).toBe(parseEther("25"));
  });

  test("fits small screens and passes an accessibility scan", async () => {
    for (const route of ["Rounds", "My tickets", "BONA", "Claims"]) {
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
