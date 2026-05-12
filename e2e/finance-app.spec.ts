import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const DEMO_COOKIE_NAME = "ledger_demo";

const responsiveRoutes = [
  { path: "/dashboard", heading: "Dashboard" },
  { path: "/transactions", heading: "Transactions" },
  { path: "/review", heading: "Review queue" },
  { path: "/recurring", heading: "Recurring" },
  { path: "/accounts", heading: "Accounts" },
  { path: "/settings", heading: "Settings" }
] as const;

const responsiveViewports = [
  { height: 844, name: "mobile", width: 390 },
  { height: 1024, name: "tablet", width: 768 },
  { height: 900, name: "desktop", width: 1440 }
] as const;

async function enableDemoMode(context: BrowserContext, baseURL: string) {
  const url = new URL(baseURL);

  await context.addCookies([{
    domain: url.hostname,
    expires: Math.floor(Date.now() / 1000) + 86_400,
    httpOnly: true,
    name: DEMO_COOKIE_NAME,
    path: "/",
    sameSite: "Lax",
    secure: url.protocol === "https:",
    value: "1"
  }]);
}

async function expectNoPageOverflow(page: Page) {
  const metrics = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth
  }));

  expect(Math.max(metrics.bodyScrollWidth, metrics.documentScrollWidth)).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

test("demo login opens the seeded finance workspace", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("button", { name: /enter demo/i })).toBeVisible();
  await page.getByRole("button", { name: /enter demo/i }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByLabel("Balance dashboard").getByText("Net worth", { exact: true }).first()).toBeVisible();
});

for (const route of responsiveRoutes) {
  for (const viewport of responsiveViewports) {
    test(`${route.path} has no page-level overflow at ${viewport.name}`, async ({ baseURL, context, page }) => {
      await enableDemoMode(context, baseURL!);
      await page.setViewportSize(viewport);
      await page.goto(route.path);

      await expect(page.getByRole("heading", { exact: true, name: route.heading })).toBeVisible();
      await expectNoPageOverflow(page);
    });
  }
}

test("dashboard trend range controls update the change-over-time view", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/dashboard");

  const chart = page.locator("svg[aria-label='Net worth balance trend']");
  await expect(chart).toBeVisible();

  const cashView = page.getByRole("button", { exact: true, name: "Cash balance view" });
  await cashView.click();
  await expect(cashView).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("svg[aria-label='Cash balance trend']")).toBeVisible();

  const liabilitiesView = page.getByRole("button", { exact: true, name: "Liabilities balance view" });
  await liabilitiesView.click();
  await expect(liabilitiesView).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("svg[aria-label='Liabilities balance trend']")).toBeVisible();

  const cashMinusLiabilitiesView = page.getByRole("button", { exact: true, name: "Cash - liabilities balance view" });
  await cashMinusLiabilitiesView.click();
  await expect(cashMinusLiabilitiesView).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("svg[aria-label='Cash - liabilities balance trend']")).toBeVisible();

  const netWorthView = page.getByRole("button", { exact: true, name: "Net worth balance view" });
  await netWorthView.click();
  await expect(netWorthView).toHaveAttribute("aria-pressed", "true");

  const oneYear = page.getByRole("button", { name: "1Y" });
  await oneYear.click();
  await expect(oneYear).toHaveAttribute("aria-pressed", "true");

  const oneMonth = page.getByRole("button", { name: "1M" });
  await oneMonth.click();
  await expect(oneMonth).toHaveAttribute("aria-pressed", "true");

  const chartBox = await chart.boundingBox();
  expect(chartBox?.width ?? 0).toBeGreaterThan(250);
  expect(chartBox?.height ?? 0).toBeGreaterThan(100);
  await expect(page.getByText(/balance snapshots available/i)).toBeVisible();
  await expect(page.getByText("Selected point")).toBeVisible();
  await expect(page.getByText("Y-axis scale")).toBeVisible();

  const trendPoints = chart.locator("g[role='button']");
  const trendPointCount = await trendPoints.count();
  expect(trendPointCount).toBeGreaterThan(1);
  await trendPoints.nth(Math.min(1, trendPointCount - 1)).click();
  await expect(page.getByText("Point change")).toBeVisible();
  await expectNoPageOverflow(page);
});

test("transaction search filters, topbar search, and CSV export stay aligned", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/transactions");

  const filterForm = page.locator("form[action='/transactions']");
  await filterForm.locator("input[name='q']").fill("Lyft");
  await filterForm.getByRole("button", { name: /apply/i }).click();

  await expect(page).toHaveURL(/\/transactions\?.*q=Lyft/);
  await expect(page.getByText("Rows shown")).toBeVisible();
  await expect(page.getByText("Lyft").first()).toBeVisible();

  const exportResponse = await page.request.get("/api/export/transactions?q=Lyft");
  expect(exportResponse.status()).toBe(200);
  const csv = await exportResponse.text();
  expect(csv).toContain("Lyft");
  expect(csv).toContain("plaid_name");

  const tableScroll = page.locator("[class*='tableScroll']").first();
  await expect(tableScroll).toBeVisible();
  const tableMetrics = await tableScroll.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth
  }));
  expect(tableMetrics.scrollWidth).toBeGreaterThanOrEqual(tableMetrics.clientWidth);

  await page.getByRole("button", { name: /open transaction search/i }).click();
  await expect(page.locator(".search-layer")).toHaveClass(/search-open/);

  const topbarSearch = page.locator("#mobile-transaction-search input[name='q']");
  await topbarSearch.fill("OpenAI");
  await topbarSearch.press("Enter");
  await expect(page).toHaveURL(/\/transactions\?.*q=OpenAI/);
  await expect(topbarSearch).toBeFocused();
  await expect(page.getByText("OpenAI").first()).toBeVisible();
  await expectNoPageOverflow(page);
});

test("settings reports AI provider status without exposing credentials", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.goto("/settings");

  await expect(page.getByText("Suggestion status")).toBeVisible();
  await expect(page.getByText(/OpenAI ready|Fallback active/)).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/sk-[A-Za-z0-9]/);
  await expectNoPageOverflow(page);
});
