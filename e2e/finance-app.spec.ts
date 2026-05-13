import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const DEMO_COOKIE_NAME = "ledger_demo";

const responsiveRoutes = [
  { path: "/dashboard", heading: "Dashboard" },
  { path: "/transactions", heading: "Transactions" },
  { path: "/agent-inbox", heading: "Agent inbox" },
  { path: "/review", heading: "Review queue" },
  { path: "/recurring", heading: "Recurring" },
  { path: "/accounts", heading: "Accounts" },
  { path: "/settings", heading: "Settings" }
] as const;

const responsiveViewports = [
  { height: 844, name: "mobile-390", width: 390 },
  { height: 932, name: "mobile-430", width: 430 },
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
  const metrics = await page.evaluate(() => {
    const offenders = Array.from(document.querySelectorAll("body *"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const className = typeof element.className === "string" ? element.className : "";

        return {
          className: className.slice(0, 120),
          clientWidth: element.clientWidth,
          id: element.id,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          scrollWidth: element.scrollWidth,
          tag: element.tagName.toLowerCase(),
          text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80)
        };
      })
      .filter((element) => (
        element.left < -1 ||
        element.right > window.innerWidth + 1 ||
        element.scrollWidth > element.clientWidth + 1
      ))
      .slice(0, 8);

    return {
      bodyScrollWidth: document.body.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      offenders
    };
  });

  expect(
    Math.max(metrics.bodyScrollWidth, metrics.documentScrollWidth),
    `Page overflow metrics: ${JSON.stringify(metrics, null, 2)}`
  ).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function expectNoSensitiveFinanceText(page: Page) {
  const bodyText = await page.locator("body").innerText();

  expect(bodyText).not.toMatch(/demo-token/i);
  expect(bodyText).not.toMatch(/access_token/i);
  expect(bodyText).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/i);
  expect(bodyText).not.toMatch(/PLAID_(?:SECRET|CLIENT_ID)/i);
  expect(bodyText).not.toMatch(/sk-[A-Za-z0-9]/);
}

async function expectTransactionControlsVisible(page: Page) {
  const metrics = await page.evaluate(() => {
    const tableScroll = document.querySelector("[class*='tableScroll']");
    const amount = document.querySelector("td[data-label='Amount']");
    const edit = document.querySelector("td[data-label='Edit']");
    const amountRect = amount?.getBoundingClientRect();
    const editRect = edit?.getBoundingClientRect();

    return {
      amountRight: amountRect ? Math.round(amountRect.right) : null,
      editRight: editRect ? Math.round(editRect.right) : null,
      scrollDelta: tableScroll ? tableScroll.scrollWidth - tableScroll.clientWidth : null,
      viewportWidth: window.innerWidth
    };
  });

  expect(metrics.amountRight, `Amount cell metrics: ${JSON.stringify(metrics, null, 2)}`).not.toBeNull();
  expect(metrics.editRight, `Edit cell metrics: ${JSON.stringify(metrics, null, 2)}`).not.toBeNull();
  expect(metrics.amountRight!, `Amount cell metrics: ${JSON.stringify(metrics, null, 2)}`).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.editRight!, `Edit cell metrics: ${JSON.stringify(metrics, null, 2)}`).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  expect(metrics.scrollDelta!, `Transaction table scroll metrics: ${JSON.stringify(metrics, null, 2)}`).toBeLessThanOrEqual(1);
}

test("demo login opens the seeded finance workspace", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("button", { name: /enter demo/i })).toBeVisible();
  await page.getByRole("button", { name: /enter demo/i }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByLabel("Balance dashboard").getByText("Net worth", { exact: true }).first()).toBeVisible();
});

test("app shell navigation and global search reach the primary workspace routes", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/dashboard");

  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const routes = [
    { heading: "Transactions", label: "Transactions", path: "/transactions" },
    { heading: "Review queue", label: "Review", path: "/review" },
    { heading: "Recurring", label: "Recurring", path: "/recurring" },
    { heading: "Accounts", label: "Accounts", path: "/accounts" },
    { heading: "Settings", label: "Settings", path: "/settings" },
    { heading: "Dashboard", label: "Dashboard", path: "/dashboard" }
  ] as const;

  for (const route of routes) {
    const link = nav.getByRole("link", { exact: true, name: route.label });
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${route.path}$`), { timeout: 15_000 });
    await expect(page.getByRole("heading", { exact: true, name: route.heading })).toBeVisible({ timeout: 15_000 });
    await expect(link).toHaveAttribute("aria-current", "page");
    await expectNoSensitiveFinanceText(page);
  }

  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: /open transaction search/i }).click();
  const search = page.locator("#mobile-transaction-search input[name='q']");
  await search.fill("Retail Wash");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/transactions\?.*q=Retail\+Wash/);
  await expect(search).toBeFocused();
  await expect(page.getByRole("heading", { exact: true, name: "Transactions" })).toBeVisible();
  await expect(page.getByText("Retail Wash").first()).toBeVisible();
  await expectNoPageOverflow(page);
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
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/dashboard");

  let chart = page.locator("svg[aria-label='Cash - liabilities balance trend']");
  await expect(chart).toBeVisible();
  const cashMinusLiabilitiesView = page.getByRole("button", { exact: true, name: "Cash - liabilities balance view" });
  const balanceRangeControls = page.getByLabel("Balance trend range");
  await expect(cashMinusLiabilitiesView).toHaveAttribute("aria-pressed", "true");
  await expect(balanceRangeControls.getByRole("button", { exact: true, name: "1W" })).toHaveAttribute("aria-pressed", "true");

  const cashView = page.getByRole("button", { exact: true, name: "Cash balance view" });
  await cashView.click();
  await expect(cashView).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("svg[aria-label='Cash balance trend']")).toBeVisible();

  const liabilitiesView = page.getByRole("button", { exact: true, name: "Liabilities balance view" });
  await liabilitiesView.click();
  await expect(liabilitiesView).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("svg[aria-label='Liabilities balance trend']")).toBeVisible();

  await cashMinusLiabilitiesView.click();
  await expect(cashMinusLiabilitiesView).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("svg[aria-label='Cash - liabilities balance trend']")).toBeVisible();

  const netWorthView = page.getByRole("button", { exact: true, name: "Net worth balance view" });
  await netWorthView.click();
  await expect(netWorthView).toHaveAttribute("aria-pressed", "true");
  chart = page.locator("svg[aria-label='Net worth balance trend']");
  await expect(chart).toBeVisible();

  const oneYear = balanceRangeControls.getByRole("button", { name: "1Y" });
  await oneYear.click();
  await expect(oneYear).toHaveAttribute("aria-pressed", "true");

  const oneMonth = balanceRangeControls.getByRole("button", { name: "1M" });
  await oneMonth.click();
  await expect(oneMonth).toHaveAttribute("aria-pressed", "true");

  const chartBox = await chart.boundingBox();
  expect(chartBox?.width ?? 0).toBeGreaterThan(250);
  expect(chartBox?.height ?? 0).toBeGreaterThan(100);
  await expect(page.getByText(/balance snapshots available/i)).toBeVisible();
  await expect(page.getByText("Selected period", { exact: true })).toBeVisible();
  await expect(page.getByText("Transactions in selected period")).toBeVisible();
  await expect(page.getByLabel("Selected balance transactions").getByRole("link", { name: "Open transactions" })).toHaveAttribute("href", /month=2026-05/);

  const categoryMonthView = page.getByRole("button", { exact: true, name: "Month" });
  await expect(categoryMonthView).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Month").getByRole("button").first()).toBeVisible();

  const categoryTrendView = page.getByRole("button", { exact: true, name: "Trend" });
  await categoryTrendView.click();
  await expect(categoryTrendView).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("svg[aria-label='Category spending trend']")).toBeVisible();
  const categoryRange = page.getByLabel("Category trend range");
  await expect(categoryRange.getByRole("button", { exact: true, name: "1M" })).toHaveAttribute("aria-pressed", "true");
  await categoryRange.getByRole("button", { exact: true, name: "3M" }).click();
  await expect(categoryRange.getByRole("button", { exact: true, name: "3M" })).toHaveAttribute("aria-pressed", "true");
  await categoryMonthView.click();
  await expect(categoryMonthView).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Month").getByRole("button").first()).toBeVisible();
  await categoryTrendView.click();
  await expect(categoryTrendView).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("svg[aria-label='Category spending trend']")).toBeVisible();

  const incomePanel = page.getByLabel("Income by category");
  await expect(incomePanel).toBeVisible();
  await expect(incomePanel).toContainText("transfers excluded");
  await expect(page.getByLabel("Income month").getByRole("button").first()).toBeVisible();

  const trendPoints = chart.locator("g[role='button']");
  const trendPointCount = await trendPoints.count();
  expect(trendPointCount).toBeGreaterThan(1);
  await trendPoints.nth(Math.min(1, trendPointCount - 1)).hover();
  await expect(page.getByText("Selected point", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Selected balance transactions")).toBeVisible();
  const transactionScope = page.getByLabel("Transaction scope");
  await expect(transactionScope.getByRole("button")).toHaveCount(3);
  await expect(transactionScope.getByRole("button", { exact: true, name: "Up to point" })).toHaveCount(0);
  await expect(transactionScope.getByRole("button", { exact: true, name: "Point" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Transactions for selected point")).toBeVisible();
  await trendPoints.nth(Math.min(2, trendPointCount - 1)).click();
  await expect(page.getByText("Selected point", { exact: true })).toBeVisible();
  await transactionScope.getByRole("button", { exact: true, name: "Before" }).click();
  await expect(transactionScope.getByRole("button", { exact: true, name: "Before" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Transactions before selected point")).toBeVisible();
  await transactionScope.getByRole("button", { exact: true, name: "After" }).click();
  await expect(transactionScope.getByRole("button", { exact: true, name: "After" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Transactions after selected point")).toBeVisible();
  await transactionScope.getByRole("button", { exact: true, name: "Point" }).click();
  await expect(transactionScope.getByRole("button", { exact: true, name: "Point" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Transactions for selected point")).toBeVisible();
  await page.getByRole("button", { exact: true, name: "Clear point" }).click();
  await expect(page.getByText("Transactions in selected period")).toBeVisible();
  await expectNoPageOverflow(page);
});

test("dashboard keeps the balance trend readable on mobile", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/dashboard");

  const chart = page.locator("svg[aria-label='Cash - liabilities balance trend']");
  await expect(chart).toBeVisible();
  const chartBox = await chart.boundingBox();

  expect(chartBox?.width).toBeGreaterThan(300);
  expect(chartBox?.height).toBeGreaterThan(160);

  const oneMonth = page.getByLabel("Balance trend range").getByRole("button", { exact: true, name: "1M" });
  await oneMonth.click();
  await expect(oneMonth).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Period change")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open transactions" }).first()).toBeVisible();
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

test("transactions keep amount and edit controls visible at laptop width", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 844, width: 1100 });
  await page.goto("/transactions");

  await expect(page.getByRole("heading", { exact: true, name: "Transactions" })).toBeVisible();
  await expectTransactionControlsVisible(page);
  await expectNoPageOverflow(page);
});

test("transaction filters, detail view, cleanup guardrail, and export safety work together", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/transactions");

  await expectTransactionControlsVisible(page);

  const filterForm = page.locator("form[action='/transactions']");
  await expect(filterForm.locator("select[name='category']")).toContainText("Software");
  await expect(filterForm.locator("select[name='category']")).not.toContainText("Transfer");
  await filterForm.locator("input[name='q']").fill("Retail Wash");
  await filterForm.locator("select[name='review']").selectOption("open");
  await filterForm.getByRole("button", { name: /apply/i }).click();

  await expect(page).toHaveURL(/\/transactions\?.*q=Retail\+Wash/);
  await expect(page).toHaveURL(/review=open/);
  const transactionTable = page.getByLabel("Persisted transactions");
  await expect(transactionTable.locator("thead")).not.toContainText("Review");
  await expect(transactionTable).toContainText("Retail Wash");
  await expect(transactionTable).toContainText("Needs review");
  await expect(transactionTable).toContainText("Uncategorized");
  await expect(transactionTable).not.toContainText("Service");
  await expect(transactionTable).not.toContainText("4421");

  const filteredExport = await page.request.get("/api/export/transactions?q=Retail+Wash&review=open&reason=missing-category&quality=needs-cleanup");
  expect(filteredExport.status()).toBe(200);
  expect(filteredExport.headers()["cache-control"]).toContain("no-store");
  const csv = await filteredExport.text();
  expect(csv).toContain("Retail Wash");
  expect(csv).not.toMatch(/demo-token|access_token|SUPABASE_SERVICE_ROLE_KEY|PLAID_SECRET|sk-[A-Za-z0-9]/i);

  await page.getByLabel("Merchant cleanup").getByRole("button", { name: /apply cleanup/i }).click();
  await expect(page.getByRole("alert").filter({ hasText: /demo mode is read-only/i })).toBeVisible();

  await page.goto("/transactions?from=2026-05-10&to=2026-05-01");
  await expect(page.getByText(/selected date filters do not overlap/i)).toBeVisible();

  await page.getByRole("link", { exact: true, name: "Reset" }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await page.goto("/transactions/t21");

  await expect(page.getByRole("heading", { name: "OpenAI" })).toBeVisible();
  await expect(page.getByLabel("Read-only transaction details")).toContainText("Raw Plaid merchant");
  await expect(page.getByLabel("Read-only transaction details")).toContainText("Plaid transaction");
  await expect(page.locator("input[name='merchantName']")).toHaveValue("OpenAI");
  await expect(page.getByText("Category / subcategory")).toHaveCount(0);
  await expect(page.locator("select[name='baseIntent']")).toContainText("Personal");
  await expect(page.locator("select[name='baseIntent']")).toContainText("Business");
  await expect(page.locator("select[name='baseIntent']")).not.toContainText("Transfer");
  await expect(page.locator("select[name='baseIntent']")).not.toContainText("Reimbursable");
  await expect(page.locator("select[name='tag']")).toHaveCount(0);
  await expect(page.getByLabel("Transaction flags").getByLabel("Recurring")).toBeVisible();
  await expect(page.getByLabel("Transaction flags").getByLabel("Reimbursable")).toBeVisible();
  await expect(page.getByLabel("Transaction flags").getByLabel("Transfer")).toBeVisible();
  await expect(page.locator("select[name='categoryId']")).not.toContainText("Transfer");
  await page.locator("select[name='categoryId']").selectOption("__new_category__");
  await expect(page.locator("input[name='newCategoryName']")).toBeVisible();
  await expectNoSensitiveFinanceText(page);
  await expectNoPageOverflow(page);
});

test("review queue exposes peer-to-peer, AI suggestion, and inline edit workflows", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/review");

  await expect(page.getByLabel("Review queue summary")).toContainText("Needs your input");
  await expect(page.getByRole("heading", { name: /peer-to-peer/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Needs categorization/i })).toBeVisible();

  const peerCard = page.locator("article", { has: page.getByRole("heading", { name: "Venmo - Maya R." }) });
  await expect(peerCard).toContainText("Explain this peer-to-peer payment.");
  await expect(peerCard.getByText("Fully allocated")).toBeVisible();
  await expect(peerCard.getByRole("button", { name: /save and resolve/i })).toBeDisabled();
  await peerCard.getByLabel("Explanation").fill("Dinner split with Maya");
  await expect(peerCard.getByRole("button", { name: /save and resolve/i })).toBeEnabled();
  await peerCard.getByRole("button", { name: /add split/i }).click();
  await expect(peerCard.getByRole("button", { name: /remove split row 2/i })).toBeVisible();

  const aiCard = page.locator("article", { has: page.getByRole("heading", { name: "Delta Air Lines" }) });
  await expect(aiCard.getByRole("button", { name: /ask openai|refresh openai suggestion|run rules suggestion|refresh rules suggestion/i })).toBeVisible();
  await expect(aiCard.getByRole("button", { name: /accept suggestion/i })).toBeVisible();
  await expect(aiCard.getByRole("button", { name: /dismiss/i })).toBeVisible();
  await aiCard.getByRole("button", { name: /edit here/i }).click();
  await expect(aiCard.locator("input[name='merchantName']")).toHaveValue("Delta Air Lines");
  await expect(aiCard.getByRole("button", { name: /save and finalize/i })).toBeVisible();
  await aiCard.getByRole("button", { name: /cancel/i }).click();
  await expect(aiCard.getByRole("button", { name: /edit here/i })).toBeVisible();

  await expectNoSensitiveFinanceText(page);
  await expectNoPageOverflow(page);
});

test("agent inbox keeps proposal context sanitized and links back to review and transaction detail", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/agent-inbox");

  await expect(page.getByLabel("Agent inbox summary")).toContainText("Proposals");
  await expect(page.getByLabel("Agent inbox safety")).toContainText("sanitized");
  await expect(page.locator("article").first()).toBeVisible();
  await expect(page.locator("article").first()).toContainText(/Accept ready|Needs review/);
  await expectNoSensitiveFinanceText(page);

  await page.locator("article").first().getByRole("link", { exact: true, name: "Review" }).click();
  await expect(page).toHaveURL(/\/review#review-demo-review-/);
  await expect(page.getByRole("heading", { exact: true, name: "Review queue" })).toBeVisible();

  await page.goto("/agent-inbox");
  await page.getByRole("link", { name: "Open transaction" }).first().click();
  await expect(page).toHaveURL(/\/transactions\/t\d+/);
  await expect(page.getByLabel("Read-only transaction details")).toBeVisible();
  await expectNoSensitiveFinanceText(page);
});

test("recurring and accounts pages render cashflow, accounts, and seeded finance rows", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });

  await page.goto("/recurring");
  await expect(page.getByLabel("Recurring summary")).toContainText("Tracked recurring");
  await expect(page.getByLabel("Recurring summary")).toContainText("Monthly estimate");
  await expect(page.getByRole("heading", { name: "Next 30 days" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recurring expenses" })).toBeVisible();
  await expect(page.getByText("Equinox").first()).toBeVisible();
  await expect(page.getByText("Substack").first()).toBeVisible();
  await expectNoSensitiveFinanceText(page);
  await expectNoPageOverflow(page);

  await page.goto("/accounts");
  await expect(page.getByText("Bank connections", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sync$/ })).toBeVisible();
  await expect(page.getByLabel("Connected accounts")).toContainText("connected");
  await expect(page.getByLabel("Connected accounts")).toContainText("Schools First");
  await expect(page.getByLabel("Connected accounts")).toContainText("Chase");
  await expect(page.getByLabel("Connected accounts")).toContainText("Balance only");
  await expectNoSensitiveFinanceText(page);
  await expectNoPageOverflow(page);
});

test("settings keeps bank connections and access controls simple", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/settings");

  await expect(page.getByText("Bank connections", { exact: true })).toBeVisible();
  await expect(page.getByText("Last successful sync")).toBeVisible();
  await expect(page.getByText("Schools First FCU")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Access" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await expect(page.getByText("Environment", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Items", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Institutions", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Production mode imports real account balances")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Setup checklist" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Personal Ledger" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Latest Plaid run" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Spending categories" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Saved category automation" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Suggestion status" })).toHaveCount(0);
  await expect(page.getByText(/OpenAI auto review|Manual AI ready|Fallback active/)).toHaveCount(0);

  await expectNoSensitiveFinanceText(page);
  await expectNoPageOverflow(page);
});
