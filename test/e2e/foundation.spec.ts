import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const routes = ["/", "/tickets", "/bona", "/claims"];

test("fails closed where Bonanza isn't deployed", async ({ page }) => {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  for (const route of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", { name: "Not live yet" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Bonanza" })).toBeVisible();
  }
  expect(failures).toEqual([]);
});

test("carries Bonanza's own identity", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Bonanza");
  const description = page.locator('meta[name="description"]');
  await expect(description).toHaveAttribute("content", /drand/);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Bonanza");
  await expect(page.locator('link[rel="icon"]').first()).toHaveAttribute("href", /icon\.svg/);
});

test("sends the security headers", async ({ request }) => {
  const response = await request.get("/");
  expect(response.headers()["x-frame-options"]).toBe("DENY");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  expect(response.headers()["x-powered-by"]).toBeUndefined();
});

test("refuses browser RPC calls with no configured upstream", async ({ request }) => {
  const response = await request.post("/api/rpc/46630", {
    data: { jsonrpc: "2.0", id: 1, method: "eth_chainId" },
  });
  expect(response.status()).toBe(503);
  expect(await response.text()).not.toMatch(/https?:/);
});

test("has no horizontal overflow and passes an accessibility scan", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Not live yet" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBe(0);
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map((violation) => violation.id)).toEqual([]);
});
