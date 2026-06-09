import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const DEMO_COOKIE_NAME = "ledger_demo";

const responsiveRoutes = [
  { path: "/dashboard", heading: "Dashboard" },
  { path: "/transactions", heading: "Transactions" },
  { path: "/agent-inbox", heading: "Agent inbox" },
  { path: "/review", heading: "Review queue" },
  { path: "/recurring", heading: "Recurring" },
  { path: "/accounts", heading: "Accounts" },
  { path: "/audit", heading: "Advanced audit" },
  { path: "/settings", heading: "Settings" }
] as const;

const responsiveViewports = [
  { height: 812, name: "mobile-375", width: 375 },
  { height: 844, name: "mobile-390", width: 390 },
  { height: 932, name: "mobile-430", width: 430 },
  { height: 932, name: "mobile-603", width: 603 },
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

async function expectNoVisibleLegacyBrand(page: Page) {
  await expect(page.getByText(/\bLedger\b/)).toHaveCount(0);
}

async function expectDesignSystemTypography(page: Page) {
  const metrics = await page.evaluate(() => {
    function isVisible(element: Element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }

    const root = window.getComputedStyle(document.documentElement);
    const body = window.getComputedStyle(document.body);
    const title = document.querySelector(".topbar-title");
    const titleStyle = title ? window.getComputedStyle(title) : null;
    const interactive = Array.from(document.querySelectorAll("button, a, input, select, textarea"))
      .filter(isVisible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = (element.textContent ?? (element as HTMLInputElement).value ?? "").trim().replace(/\s+/g, " ");

        return {
          fontSize: Number.parseFloat(style.fontSize),
          height: Math.round(rect.height),
          scrollDelta: Math.round(element.scrollWidth - element.clientWidth),
          tag: element.tagName.toLowerCase(),
          text: text.slice(0, 60),
          width: Math.round(rect.width)
        };
      });

    const clippedControls = interactive
      .filter((element) => element.width > 0 && element.scrollDelta > 24)
      .slice(0, 8);
    const tinyControls = interactive
      .filter((element) => element.fontSize < 10)
      .slice(0, 8);

    return {
      bodyFont: Number.parseFloat(body.fontSize),
      bodyLineHeight: Number.parseFloat(body.lineHeight),
      clippedControls,
      fontMono: root.getPropertyValue("--font-mono").trim(),
      fontSerif: root.getPropertyValue("--font-serif").trim(),
      fontSans: root.getPropertyValue("--font-sans").trim(),
      sage: root.getPropertyValue("--sage").trim().toLowerCase(),
      sageInk: root.getPropertyValue("--sage-ink").trim().toLowerCase(),
      sageSoft: root.getPropertyValue("--sage-soft").trim().toLowerCase(),
      textBody: root.getPropertyValue("--text-body").trim(),
      tinyControls,
      titleFont: titleStyle?.fontFamily ?? "",
      titleSize: titleStyle ? Number.parseFloat(titleStyle.fontSize) : null,
      viewportWidth: window.innerWidth
    };
  });

  expect(metrics.sage).toBe("#6c8a6a");
  expect(metrics.sageInk).toBe("#4f6a4d");
  expect(metrics.sageSoft).toBe("#e1ebe0");
  expect(metrics.textBody).toBe("15px");
  expect(metrics.fontSans).toContain("Inter Tight");
  expect(metrics.fontSerif).toContain("Instrument Serif");
  expect(metrics.fontMono).toContain("JetBrains Mono");
  expect(metrics.bodyFont).toBeGreaterThanOrEqual(15);
  expect(metrics.bodyLineHeight).toBeGreaterThanOrEqual(21);
  expect(metrics.titleSize, `Typography metrics: ${JSON.stringify(metrics, null, 2)}`).not.toBeNull();
  expect(metrics.titleSize!, `Typography metrics: ${JSON.stringify(metrics, null, 2)}`).toBeGreaterThanOrEqual(
    metrics.viewportWidth < 720 ? 20 : 34
  );
  expect(metrics.titleFont, `Typography metrics: ${JSON.stringify(metrics, null, 2)}`).toMatch(/Instrument Serif|Georgia|Times/);
  expect(metrics.tinyControls, `Typography metrics: ${JSON.stringify(metrics, null, 2)}`).toHaveLength(0);
  expect(metrics.clippedControls, `Typography metrics: ${JSON.stringify(metrics, null, 2)}`).toHaveLength(0);
}

async function expectReducedMotionSafe(page: Page) {
  const metrics = await page.evaluate(() => {
    function isVisible(element: Element) {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }

    function durationToMs(value: string) {
      return value.split(",").map((raw) => {
        const token = raw.trim();
        if (token.endsWith("ms")) return Number.parseFloat(token);
        if (token.endsWith("s")) return Number.parseFloat(token) * 1000;
        return Number.parseFloat(token) || 0;
      });
    }

    const offenders = Array.from(document.querySelectorAll("body *"))
      .filter(isVisible)
      .map((element) => {
        const style = window.getComputedStyle(element);
        const maxAnimation = Math.max(...durationToMs(style.animationDuration), 0);
        const maxTransition = Math.max(...durationToMs(style.transitionDuration), 0);

        return {
          animationDuration: style.animationDuration,
          className: typeof element.className === "string" ? element.className.slice(0, 120) : "",
          maxAnimation,
          maxTransition,
          tag: element.tagName.toLowerCase(),
          text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
          transitionDuration: style.transitionDuration
        };
      })
      .filter((element) => element.maxAnimation > 5 || element.maxTransition > 5)
      .slice(0, 8);

    return { offenders };
  });

  expect(metrics.offenders, `Reduced motion offenders: ${JSON.stringify(metrics.offenders, null, 2)}`).toHaveLength(0);
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

async function expectTransactionStatusBadgesVisible(page: Page) {
  const metrics = await page.evaluate(() => {
    const badges = Array.from(document.querySelectorAll("[class*='statusTags'] > span"))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          height: Math.round(rect.height),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          text: (element.textContent ?? "").trim(),
          width: Math.round(rect.width)
        };
      });

    return {
      badges,
      viewportWidth: window.innerWidth
    };
  });

  expect(metrics.badges.length, `Status badge metrics: ${JSON.stringify(metrics, null, 2)}`).toBeGreaterThan(0);
  for (const badge of metrics.badges) {
    expect(badge.width, `Status badge metrics: ${JSON.stringify(metrics, null, 2)}`).toBeGreaterThan(12);
    expect(badge.height, `Status badge metrics: ${JSON.stringify(metrics, null, 2)}`).toBeGreaterThan(16);
    expect(badge.left, `Status badge metrics: ${JSON.stringify(metrics, null, 2)}`).toBeGreaterThanOrEqual(0);
    expect(badge.right, `Status badge metrics: ${JSON.stringify(metrics, null, 2)}`).toBeLessThanOrEqual(metrics.viewportWidth + 1);
  }
}

test("demo login opens the seeded finance workspace", async ({ page }) => {
  await page.goto("/login");

  await expect(page).toHaveTitle("Tally - Personal Finance Copilot");
  await expect(page.getByText("Tally", { exact: true })).toBeVisible();
  await expect(page.getByText("Personal finance copilot", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in to Tally" })).toBeVisible();
  await expect(page.getByRole("button", { name: /enter demo/i })).toBeVisible();
  await expectNoVisibleLegacyBrand(page);
  await page.getByRole("button", { name: /enter demo/i }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Tally dashboard" })).toBeVisible();
  await expect(page.getByText("Seeded demo workspace")).toBeVisible();
  await expect(page.getByText("Real data workspace")).toHaveCount(0);
  const balanceView = page.getByLabel("Balance view");
  await expect(balanceView.getByRole("button", { exact: true, name: "Cash flow balance view" })).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
  await expect(balanceView.getByRole("button").nth(0)).toContainText("Cash flow");
  await expect(balanceView.getByRole("button").nth(1)).toContainText("Inflows / liquid assets");
  await expect(balanceView.getByRole("button").nth(2)).toContainText("Net worth");
  await expectNoVisibleLegacyBrand(page);
});

test("legacy credit health route redirects to dashboard card actions", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.goto("/credit-health");

  await expect(page).toHaveURL(/\/dashboard#card-actions$/);
  await expect(page.getByRole("heading", { exact: true, name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Credit card actions" })).toBeVisible();
});

test("app shell navigation and global search reach the primary workspace routes", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/dashboard");

  const brand = page.getByRole("link", { name: "Tally dashboard" });
  await expect(brand).toBeVisible();
  await expect(brand).toContainText("Tally");
  await expect(brand).not.toContainText("Copilot");
  await expectNoVisibleLegacyBrand(page);

  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const routes = [
    { heading: "Transactions", label: "Transactions", path: "/transactions" },
    { heading: "Review queue", label: "Review", path: "/review" },
    { heading: "Recurring", label: "Recurring", path: "/recurring" },
    { heading: "Accounts", label: "Accounts", path: "/accounts" },
    { heading: "Settings", label: "Settings", path: "/settings" },
    { heading: "Dashboard", label: "Dashboard", path: "/dashboard" }
  ] as const;

  await expect(nav.getByRole("link", { exact: true, name: "Credit health" })).toHaveCount(0);

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
  await expect(page.locator(".search-layer")).toHaveClass(/search-open/);
  const search = page.locator("#mobile-transaction-search input[name='q']");
  await expect(search).toBeFocused();
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

test("mobile transactions align filters, card header, and bottom navigation", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 844, width: 603 });
  await page.goto("/transactions");

  await expect(page.getByRole("heading", { exact: true, name: "Transactions" })).toBeVisible();
  const metrics = await page.evaluate(() => {
    const firstRow = document.querySelector("tbody tr");
    const merchant = firstRow?.querySelector("td[data-label='Merchant']");
    const amount = firstRow?.querySelector("td[data-label='Amount']");
    const dateCell = firstRow?.querySelector("td[data-label='Date']");
    const categoryCell = firstRow?.querySelector("td[data-label='Category']");
    const mobileMeta = firstRow?.querySelector("[class*='mobileCardMeta']");
    const mobileMetaItems = Array.from(mobileMeta?.querySelectorAll("span") ?? []).map((span) => span.textContent?.trim());
    const statusTags = firstRow?.querySelector("[class*='statusTags']");
    const filterControls = Array.from(document.querySelectorAll("form[aria-label='Transaction filters'] label"))
      .filter((label) => ["Month", "Account"].includes(label.querySelector("span")?.textContent ?? ""))
      .map((label) => {
        const control = label.querySelector("select")?.getBoundingClientRect();
        return {
          controlHeight: control?.height ?? null,
          controlTop: control?.top ?? null,
          label: label.querySelector("span")?.textContent,
          tagName: label.querySelector("select")?.tagName ?? null
        };
      });
    const navItems = Array.from(document.querySelectorAll(".nav-item")).map((item) => {
      const itemRect = item.getBoundingClientRect();
      const iconRect = item.querySelector("svg")?.getBoundingClientRect();
      const labelRect = item.querySelector("span:not(.nav-badge)")?.getBoundingClientRect();
      return {
        iconCenter: iconRect ? iconRect.left + iconRect.width / 2 : null,
        itemCenter: itemRect.left + itemRect.width / 2,
        labelCenter: labelRect ? labelRect.left + labelRect.width / 2 : null,
        text: item.textContent?.trim()
      };
    });

    return {
      amountTop: amount?.getBoundingClientRect().top ?? null,
      categoryCellDisplay: categoryCell ? getComputedStyle(categoryCell).display : null,
      dateCellDisplay: dateCell ? getComputedStyle(dateCell).display : null,
      filterControls,
      merchantNameBottom: merchant?.querySelector("[class*='merchantName']")?.getBoundingClientRect().bottom ?? null,
      merchantTop: merchant?.getBoundingClientRect().top ?? null,
      mobileMetaDisplay: mobileMeta ? getComputedStyle(mobileMeta).display : null,
      mobileMetaItems,
      mobileMetaText: mobileMeta?.textContent ?? null,
      navItems,
      statusTagsTop: statusTags?.getBoundingClientRect().top ?? null
    };
  });

  expect(metrics.filterControls).toHaveLength(2);
  const [monthControl, accountControl] = metrics.filterControls;
  expect(monthControl.tagName).toBe("SELECT");
  expect(accountControl.tagName).toBe("SELECT");
  expect(monthControl.controlTop).not.toBeNull();
  expect(accountControl.controlTop).not.toBeNull();
  expect(Math.abs((monthControl.controlTop ?? 0) - (accountControl.controlTop ?? 0))).toBeLessThanOrEqual(1);
  expect(monthControl.controlHeight).toBe(accountControl.controlHeight);

  expect(metrics.mobileMetaDisplay).toBe("flex");
  expect(metrics.mobileMetaText).toMatch(/\w+.*\w+.*\w+/);
  expect(metrics.mobileMetaItems).toHaveLength(3);
  expect(metrics.dateCellDisplay).toBe("none");
  expect(metrics.categoryCellDisplay).toBe("none");
  expect(metrics.statusTagsTop).not.toBeNull();
  expect(metrics.merchantNameBottom).not.toBeNull();
  expect(metrics.statusTagsTop ?? 0).toBeGreaterThanOrEqual(metrics.merchantNameBottom ?? 0);

  expect(metrics.amountTop).not.toBeNull();
  expect(metrics.merchantTop).not.toBeNull();
  expect(Math.abs((metrics.amountTop ?? 0) - (metrics.merchantTop ?? 0))).toBeLessThanOrEqual(4);

  for (const item of metrics.navItems) {
    expect(item.iconCenter, `${item.text} icon center`).not.toBeNull();
    expect(item.labelCenter, `${item.text} label center`).not.toBeNull();
    expect(Math.abs((item.iconCenter ?? 0) - item.itemCenter), `${item.text} icon centered`).toBeLessThanOrEqual(1);
    expect(Math.abs((item.labelCenter ?? 0) - item.itemCenter), `${item.text} label centered`).toBeLessThanOrEqual(1.5);
  }
});

test("desktop sidebar wheel input scrolls long workspace pages", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/accounts");

  const contentPane = page.locator(".page");
  await expect(page.getByRole("heading", { exact: true, name: "Accounts" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await expect(contentPane).toHaveJSProperty("scrollTop", 0);

  await page.mouse.move(120, 450);
  await page.mouse.wheel(0, 900);

  await expect.poll(async () => contentPane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expectNoPageOverflow(page);
});

test("design tokens and typography stay cohesive across finance routes", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);

  for (const viewport of [
    { height: 844, width: 390 },
    { height: 900, width: 1440 }
  ]) {
    await page.setViewportSize(viewport);

    for (const route of responsiveRoutes) {
      await page.goto(route.path);
      await expect(page.getByRole("heading", { exact: true, name: route.heading })).toBeVisible();
      await expectDesignSystemTypography(page);
      await expectNoPageOverflow(page);
    }
  }
});

test("Tally brand surfaces stay tokenized and readable at minimum width", async ({ baseURL, context, page }) => {
  await page.setViewportSize({ height: 568, width: 320 });
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Sign in to Tally" })).toBeVisible();
  await expect(page.getByText("Tally", { exact: true })).toBeVisible();
  await expect(page.getByText("Personal finance copilot", { exact: true })).toBeVisible();
  await expectNoVisibleLegacyBrand(page);
  const loginTokenMetrics = await page.evaluate(() => {
    const root = window.getComputedStyle(document.documentElement);
    const body = window.getComputedStyle(document.body);

    return {
      bodyFont: Number.parseFloat(body.fontSize),
      fontSans: root.getPropertyValue("--font-sans").trim(),
      sage: root.getPropertyValue("--sage").trim().toLowerCase(),
      sageInk: root.getPropertyValue("--sage-ink").trim().toLowerCase(),
      sageSoft: root.getPropertyValue("--sage-soft").trim().toLowerCase()
    };
  });
  expect(loginTokenMetrics.sage).toBe("#6c8a6a");
  expect(loginTokenMetrics.sageInk).toBe("#4f6a4d");
  expect(loginTokenMetrics.sageSoft).toBe("#e1ebe0");
  expect(loginTokenMetrics.fontSans).toContain("Inter Tight");
  expect(loginTokenMetrics.bodyFont).toBeGreaterThanOrEqual(15);
  await expectNoPageOverflow(page);

  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/dashboard");

  const brandMetrics = await page.evaluate(() => {
    const root = window.getComputedStyle(document.documentElement);
    const brand = document.querySelector(".brand");
    const mark = document.querySelector(".brand-mark");
    const markSvg = document.querySelector(".brand-mark svg");
    const activeNav = document.querySelector(".nav-item.active");
    const markStyle = mark ? window.getComputedStyle(mark) : null;
    const activeStyle = activeNav ? window.getComputedStyle(activeNav) : null;

    return {
      activeBackground: activeStyle?.backgroundColor ?? "",
      activeColor: activeStyle?.color ?? "",
      brandText: brand?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      markBackground: markStyle?.backgroundColor ?? "",
      markHasSvg: Boolean(markSvg),
      sageSoft: root.getPropertyValue("--sage-soft").trim().toLowerCase()
    };
  });

  expect(brandMetrics.brandText).toContain("Tally");
  expect(brandMetrics.brandText).not.toContain("Copilot");
  expect(brandMetrics.markHasSvg).toBe(true);
  expect(brandMetrics.sageSoft).toBe("#e1ebe0");
  expect(brandMetrics.activeBackground).not.toBe("rgb(26, 28, 25)");
  expect(brandMetrics.activeColor).not.toBe("rgb(244, 244, 239)");
  await expectNoVisibleLegacyBrand(page);
  await expectNoPageOverflow(page);
});

test("Tally surfaces respect reduced motion preferences", async ({ baseURL, context, page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ height: 568, width: 320 });
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Sign in to Tally" })).toBeVisible();
  await expectReducedMotionSafe(page);
  await expectNoPageOverflow(page);

  await enableDemoMode(context, baseURL!);
  for (const route of [
    { heading: "Dashboard", path: "/dashboard" },
    { heading: "Settings", path: "/settings" }
  ] as const) {
    await page.goto(route.path);
    await expect(page.getByRole("heading", { exact: true, name: route.heading })).toBeVisible();
    await expectReducedMotionSafe(page);
    await expectNoPageOverflow(page);
  }
});

test("dashboard keeps the old cashflow runway off the main surface", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/dashboard");

  await expect(page.getByRole("region", { name: "Monthly cashflow runway" })).toHaveCount(0);
  await expect(page.getByText("Cashflow watch")).toHaveCount(0);
  await expect(page.getByText("Income this month")).toHaveCount(0);
});

test("dashboard trend range controls update the change-over-time view", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/dashboard");

  let chart = page.locator("svg[aria-label='Cash flow balance trend']");
  await expect(chart).toBeVisible();
  const netWorthView = page.getByRole("button", { exact: true, name: "Net worth balance view" });
  const incomeView = page.getByRole("button", { exact: true, name: "Inflows / liquid assets balance view" });
  const cashFlowView = page.getByRole("button", { exact: true, name: "Cash flow balance view" });
  const balanceRangeControls = page.getByLabel("Balance trend range");
  await expect(cashFlowView).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Balance view").getByRole("button").nth(0)).toContainText("Cash flow");
  await expect(page.getByLabel("Balance view").getByRole("button").nth(1)).toContainText("Inflows / liquid assets");
  await expect(page.getByLabel("Balance view").getByRole("button").nth(2)).toContainText("Net worth");
  await expect(netWorthView).toBeVisible();
  await expect(incomeView).toBeVisible();
  await expect(page.getByRole("button", { exact: true, name: "Debt balance view" })).toHaveCount(0);
  await expect(page.getByRole("button", { exact: true, name: "Spendable balance view" })).toHaveCount(0);
  await expect(balanceRangeControls.getByRole("button", { exact: true, name: "1W" })).toHaveAttribute("aria-pressed", "true");

  const oneYear = balanceRangeControls.getByRole("button", { name: "1Y" });
  await oneYear.click();
  await expect(oneYear).toHaveAttribute("aria-pressed", "true");

  const oneMonth = balanceRangeControls.getByRole("button", { name: "1M" });
  await oneMonth.click();
  await expect(oneMonth).toHaveAttribute("aria-pressed", "true");

  const chartBox = await chart.boundingBox();
  expect(chartBox?.width ?? 0).toBeGreaterThan(250);
  expect(chartBox?.height ?? 0).toBeGreaterThan(100);
  await netWorthView.click();
  await expect(netWorthView).toHaveAttribute("aria-pressed", "true");
  chart = page.locator("svg[aria-label='Net worth balance trend']");
  await expect(chart).toBeVisible();
  await expect(page.getByText(/balance snapshots available/i)).toBeVisible();
  await expect(page.getByText("Selected period", { exact: true })).toBeVisible();

  await cashFlowView.click();
  await expect(cashFlowView).toHaveAttribute("aria-pressed", "true");
  chart = page.locator("svg[aria-label='Cash flow balance trend']");
  await expect(chart).toBeVisible();
  await expect(page.getByText("Transactions in selected period")).toBeVisible();
  const cardActions = page.getByRole("region", { name: "Credit card actions" });
  await expect(cardActions).toBeVisible();
  await expect(cardActions).toContainText(/utilization/i);
  await expect(page.getByLabel("Spendable comparison")).toHaveCount(0);
  const selectedTransactionsHref = await page
    .getByLabel("Selected balance transactions")
    .getByRole("link", { name: "Open transactions" })
    .getAttribute("href");
  expect(selectedTransactionsHref).toMatch(/month=\d{4}-\d{2}/);

  const categoryViewControls = page.getByLabel("Category spending view");
  const categoryMonthView = categoryViewControls.getByRole("button", { exact: true, name: "Month" });
  const categoryTrendView = categoryViewControls.getByRole("button", { exact: true, name: "Trend" });
  await categoryTrendView.click();
  await expect(categoryTrendView).toHaveAttribute("aria-pressed", "true");
  await expect(categoryMonthView).toHaveAttribute("aria-pressed", "false");
  const categoryRange = page.getByLabel("Category trend range");
  await expect(categoryRange.getByRole("button", { exact: true, name: "1M" })).toHaveAttribute("aria-pressed", "true");
  await categoryRange.getByRole("button", { exact: true, name: "3M" }).click();
  await expect(categoryRange.getByRole("button", { exact: true, name: "3M" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("svg[aria-label='Category spending trend']")).toBeVisible();
  const categoryTrendLabels = await page
    .locator("svg[aria-label='Category spending trend'] text")
    .evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? "").filter((text) => text.length > 0));
  expect(categoryTrendLabels).toEqual(expect.arrayContaining(["Mar", "Apr", "May", "Jun"]));
  await categoryRange.getByRole("button", { exact: true, name: "All" }).click();
  await expect(categoryRange.getByRole("button", { exact: true, name: "All" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("svg[aria-label='Category spending trend']")).toBeVisible();
  await categoryMonthView.click();
  await expect(categoryMonthView).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Month").getByRole("button").first()).toBeVisible();
  await categoryTrendView.click();
  await expect(categoryTrendView).toHaveAttribute("aria-pressed", "true");
  await categoryRange.getByRole("button", { exact: true, name: "All" }).click();
  await expect(page.locator("svg[aria-label='Category spending trend']")).toBeVisible();

  const spendingPanel = page.getByLabel("Spending by category");
  await expect(spendingPanel.getByRole("button", { exact: true, name: "Net" })).toHaveCount(0);
  await expect(spendingPanel.getByRole("button", { exact: true, name: "Gross" })).toHaveCount(0);
  for (const removedFocus of ["Top", "Rising", "Watch", "Review"]) {
    await expect(spendingPanel.getByRole("button", { exact: true, name: removedFocus })).toHaveCount(0);
  }
  await expect(spendingPanel).not.toContainText("Net after reimbursements");
  await expect(spendingPanel).not.toContainText("trusted");
  await expect(spendingPanel).not.toContainText("in review");
  const spendingTrendLinks = await spendingPanel.getByRole("link").evaluateAll((links) => (
    links.map((link) => link.getAttribute("href") ?? "")
  ));
  expect(spendingTrendLinks.length).toBeGreaterThan(1);
  for (const href of spendingTrendLinks) {
    expect(href).toContain("direction=spending");
    expect(href).toContain("exclude_transfers=1");
    expect(href).not.toContain("basis=");
  }

  await categoryMonthView.click();
  await expect(categoryMonthView).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Month")).toContainText("$");
  await page.getByLabel("Month").getByRole("button", { name: /May 2026/ }).click();
  const spendingMonthLinks = await spendingPanel.getByRole("link").evaluateAll((links) => (
    links.map((link) => link.getAttribute("href") ?? "")
  ));
  expect(spendingMonthLinks.length).toBeGreaterThan(6);
  for (const href of spendingMonthLinks) {
    expect(href).toContain("direction=spending");
    expect(href).toContain("exclude_transfers=1");
    expect(href).not.toContain("basis=");
  }

  await incomeView.click();
  await expect(incomeView).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("svg[aria-label='Inflows / liquid assets balance trend']")).toBeVisible();

  const incomePanel = page.getByLabel("Cash inflows by category");
  await expect(incomePanel).toBeVisible();
  await expect(incomePanel).toContainText("transfers excluded");
  await expect(page.getByLabel("Cash inflow range").getByRole("button", { exact: true, name: "All" })).toHaveAttribute("aria-pressed", "true");
  const incomeLinks = await incomePanel.getByRole("link").evaluateAll((links) => (
    links.map((link) => link.getAttribute("href") ?? "")
  ));
  expect(incomeLinks.length).toBeGreaterThan(0);
  for (const href of incomeLinks) {
    expect(href).toContain("direction=income");
  }

  await cashFlowView.click();
  await expect(cashFlowView).toHaveAttribute("aria-pressed", "true");
  chart = page.locator("svg[aria-label='Cash flow balance trend']");
  await expect(chart).toBeVisible();

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

test("dashboard inflows drilldown opens income-only transactions", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.goto("/dashboard");

  await page.getByRole("button", { exact: true, name: "Inflows / liquid assets balance view" }).click();
  const activityLink = page
    .getByLabel("Selected balance transactions")
    .getByRole("link", { exact: true, name: "Open transactions" });
  await expect(activityLink).toHaveAttribute("href", /direction=income/);
  await activityLink.click();

  await expect(page).toHaveURL(/\/transactions\?.*direction=income/);
  let filterForm = page.locator("form[action='/transactions']");
  await expect(filterForm.locator("input[name='direction']")).toHaveValue("income");
  await expect(page.locator("td[aria-label^='Outflow']")).toHaveCount(0);

  await page.goto("/dashboard");
  await page.getByRole("button", { exact: true, name: "Inflows / liquid assets balance view" }).click();
  await expect(page.getByLabel("Cash inflow range").getByRole("button", { exact: true, name: "All" })).toHaveAttribute("aria-pressed", "true");

  const incomePanel = page.getByLabel("Cash inflows by category");
  const openTransactions = incomePanel.getByRole("link", { exact: true, name: "Open transactions" });
  await expect(openTransactions).toHaveAttribute("href", /direction=income/);
  await openTransactions.click();

  await expect(page).toHaveURL(/\/transactions\?.*direction=income/);
  filterForm = page.locator("form[action='/transactions']");
  await expect(filterForm.locator("input[name='direction']")).toHaveValue("income");
  await expect(page.locator("td[aria-label^='Inflow']").first()).toBeVisible();
  await expect(page.locator("td[aria-label^='Outflow']")).toHaveCount(0);
  await expectNoPageOverflow(page);
});

test("dashboard keeps the balance trend readable on mobile", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/dashboard");

  const chart = page.locator("svg[aria-label='Cash flow balance trend']");
  await expect(chart).toBeHidden();

  await expect(page.getByLabel("Mobile balance trend summary")).toBeVisible();

  const oneMonth = page.getByLabel("Balance trend range").getByRole("button", { exact: true, name: "1M" });
  await expect(oneMonth).toBeVisible();

  const shellMetrics = await page.evaluate(() => {
    const nav = document.querySelector("nav[aria-label='Main navigation']");
    const topbar = document.querySelector(".topbar");
    const navRect = nav?.getBoundingClientRect();
    const topbarRect = topbar?.getBoundingClientRect();

    return {
      navBottom: navRect ? Math.round(navRect.bottom) : null,
      navTop: navRect ? Math.round(navRect.top) : null,
      topbarTop: topbarRect ? Math.round(topbarRect.top) : null,
      viewportHeight: window.innerHeight
    };
  });

  expect(shellMetrics.topbarTop, `Mobile shell metrics: ${JSON.stringify(shellMetrics, null, 2)}`).toBe(0);
  expect(shellMetrics.navTop, `Mobile shell metrics: ${JSON.stringify(shellMetrics, null, 2)}`).toBeGreaterThan(760);
  expect(shellMetrics.navBottom, `Mobile shell metrics: ${JSON.stringify(shellMetrics, null, 2)}`).toBeLessThanOrEqual(shellMetrics.viewportHeight);
  await expectNoPageOverflow(page);
});

test("transaction search filters, topbar search, and CSV export stay aligned", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/transactions?direction=spending&exclude_transfers=1");

  const filterForm = page.locator("form[action='/transactions']");
  await expect(filterForm.locator("input[name='direction']")).toHaveValue("spending");
  await expect(filterForm.locator("input[name='exclude_transfers']")).toHaveValue("1");
  await expect(filterForm.getByRole("link", { name: /export csv/i })).toHaveAttribute(
    "href",
    /\/api\/export\/transactions\?direction=spending&exclude_transfers=1/
  );
  await filterForm.locator("input[name='q']").fill("Lyft");
  await filterForm.getByRole("button", { name: /apply/i }).click();

  await expect(page).toHaveURL(/\/transactions\?.*q=Lyft/);
  await expect(page).toHaveURL(/direction=spending/);
  await expect(page).toHaveURL(/exclude_transfers=1/);
  await expect(page.getByText("Transaction period")).toBeVisible();
  await expect(page.getByText("Lyft").first()).toBeVisible();
  await expect(filterForm.getByRole("link", { name: /export csv/i })).toHaveAttribute("href", /q=Lyft/);
  await expect(filterForm.getByRole("link", { name: /export csv/i })).toHaveAttribute("href", /direction=spending/);
  await expect(filterForm.getByRole("link", { name: /export csv/i })).toHaveAttribute("href", /exclude_transfers=1/);

  const exportResponse = await page.request.get("/api/export/transactions?q=Lyft", {
    headers: { referer: `${baseURL!}/transactions` }
  });
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
  expect(tableMetrics.scrollWidth - tableMetrics.clientWidth).toBeLessThanOrEqual(1);
  await expectTransactionControlsVisible(page);

  await page.getByRole("button", { name: /open transaction search/i }).click();
  await expect(page.locator(".search-layer")).toHaveClass(/search-open/);

  const topbarSearch = page.locator("#mobile-transaction-search input[name='q']");
  await expect(topbarSearch).toBeFocused();
  await topbarSearch.fill("OpenAI");
  await topbarSearch.press("Enter");
  await expect(page).toHaveURL(/\/transactions\?.*q=OpenAI/);
  await expect(topbarSearch).toBeFocused();
  await expect(page.getByText("OpenAI").first()).toBeVisible();
  await expectNoPageOverflow(page);
});

test("transaction review cards stay readable on narrow mobile", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/transactions?q=Retail+Wash&review=open");

  const transactionTable = page.getByLabel("Persisted transactions");
  await expect(transactionTable).toContainText("Retail Wash");
  await expect(transactionTable).toContainText("Needs review");
  await expect(transactionTable).toContainText("Needs a real category");
  await expect(transactionTable).toContainText(/\$18\.50|\-\$18\.50/);
  await expect(transactionTable.getByRole("link", { name: /edit retail wash/i }).first()).toBeVisible();
  await expectTransactionControlsVisible(page);
  await expectTransactionStatusBadgesVisible(page);
  await expectNoPageOverflow(page);
});

test("income transaction filter shows only positive inflows", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.goto("/transactions?direction=income");

  const filterForm = page.locator("form[action='/transactions']");
  await expect(filterForm.locator("input[name='direction']")).toHaveValue("income");
  expect(await page.locator("td[aria-label^='Inflow']").count()).toBeGreaterThan(0);
  await expect(page.locator("td[aria-label^='Outflow']")).toHaveCount(0);
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

  const filteredExport = await page.request.get("/api/export/transactions?q=Retail+Wash&review=open&reason=missing-category&quality=needs-cleanup", {
    headers: { referer: `${baseURL!}/transactions` }
  });
  expect(filteredExport.status()).toBe(200);
  expect(filteredExport.headers()["cache-control"]).toContain("no-store");
  const csv = await filteredExport.text();
  expect(csv).toContain("Retail Wash");
  expect(csv).not.toContain("plaid_transaction_id");
  expect(csv).not.toMatch(/demo-token|access_token|SUPABASE_SERVICE_ROLE_KEY|PLAID_SECRET|sk-[A-Za-z0-9]/i);

  const cleanupPanel = page.getByLabel("Merchant cleanup");
  await expect(cleanupPanel).toContainText("preview-only in the demo");
  await expect(cleanupPanel.getByRole("button", { name: /read-only demo/i })).toBeDisabled();

  await page.goto("/transactions?from=2026-05-10&to=2026-05-01");
  await expect(page.getByText(/selected date filters do not overlap/i)).toBeVisible();

  await page.getByRole("link", { exact: true, name: "Reset" }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await page.goto("/transactions/t21");

  await expect(page.getByRole("heading", { name: "OpenAI" })).toBeVisible();
  await expect(page.getByLabel("Read-only transaction details")).toContainText("Raw Plaid merchant");
  await expect(page.getByLabel("Read-only transaction details")).not.toContainText("Plaid transaction");
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
  await expect(page.getByRole("button", { name: /read-only demo/i })).toBeDisabled();

  await page.goto("/transactions/t25");
  const editForm = page.locator("form[aria-label='Edit transaction enrichment']");
  await expect(editForm).toBeVisible();
  const editFormBox = await editForm.boundingBox();
  const reimbursementApproval = page.getByLabel("Reimbursement linking");
  await expect(reimbursementApproval).toContainText("Reimbursement approval");
  await expect(reimbursementApproval).toContainText("Link or mark this positive inflow");
  await expect(reimbursementApproval).toContainText("$60.00 outstanding");
  await expect(reimbursementApproval).toContainText("preview-only");
  await expect(reimbursementApproval.getByRole("button", { name: /preview only/i }).first()).toBeDisabled();
  const reimbursementBox = await reimbursementApproval.boundingBox();
  expect(editFormBox?.width).toBeGreaterThan(360);
  expect(reimbursementBox?.y).toBeGreaterThan((editFormBox?.y ?? 0) + (editFormBox?.height ?? 0) - 1);
  await expectNoSensitiveFinanceText(page);
  await expectNoPageOverflow(page);
});

test("review page keeps AI quality reporting hidden from the main workflow", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/review");

  const panel = page.getByRole("region", { name: "AI suggestion quality" });
  await expect(panel).toHaveCount(0);
  await expect(page.getByText("How AI suggestions land")).toHaveCount(0);
});

test("review queue exposes peer-to-peer, AI suggestion, and inline edit workflows", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/review");

  await expect(page.getByRole("heading", { exact: true, name: "Review queue" })).toBeVisible();
  await expect(page.getByLabel("Review queue summary")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /peer-to-peer/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Categorize/i })).toBeVisible();

  const peerCard = page.locator("article", { has: page.getByRole("heading", { name: "Venmo - Maya R." }) });
  await expect(peerCard).toContainText("Explain what this payment was for");
  await expect(peerCard).toContainText("preview-only in demo mode");
  await expect(peerCard.getByText("Fully allocated")).toBeVisible();
  await expect(peerCard.getByRole("button", { name: /read-only demo/i })).toBeDisabled();
  await peerCard.getByLabel("Explanation").fill("Dinner split with Maya");
  await expect(peerCard.getByRole("button", { name: /read-only demo/i })).toBeDisabled();
  await peerCard.getByRole("button", { name: /add split/i }).click();
  await expect(peerCard.getByRole("button", { name: /remove split row 2/i })).toBeVisible();

  const aiCard = page.locator("article", { has: page.getByRole("heading", { name: "Delta Air Lines" }) });
  await expect(aiCard).toContainText("Demo review actions are read-only");
  await expect(aiCard.getByRole("button", { name: /preview suggestion/i })).toBeDisabled();
  await expect(aiCard.getByRole("button", { name: /read-only demo/i }).first()).toBeDisabled();
  await aiCard.getByRole("button", { name: /edit here/i }).click();
  await expect(aiCard.locator("input[name='merchantName']")).toHaveValue("Delta Air Lines");
  await expect(aiCard).toContainText("Inline transaction edits are preview-only");
  await expect(aiCard.getByRole("button", { name: /read-only demo/i }).last()).toBeDisabled();
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
  await expect(page.getByText("Demo proposals are preview-only")).toBeVisible();
  const readOnlyProposalButtons = page.getByRole("button", { name: "Read-only demo" });
  await expect(readOnlyProposalButtons.first()).toBeDisabled();

  const reimbursementCandidate = page.locator("article", {
    hasText: "Should this Chris L. payment be tracked as reimbursable?"
  });
  await expect(reimbursementCandidate).toContainText("AI candidate");
  await expect(reimbursementCandidate).toContainText("Venmo - Chris L.");
  await expect(reimbursementCandidate).toContainText("Shared dining pattern");
  await expect(reimbursementCandidate.getByRole("button", { name: "Read-only demo" })).toHaveCount(2);
  await expect(reimbursementCandidate.getByRole("button", { name: "Read-only demo" }).first()).toBeDisabled();
  await expect(reimbursementCandidate.getByRole("link", { name: "Open transaction" })).toHaveAttribute("href", "/transactions/t28");
  await expectNoSensitiveFinanceText(page);

  await page.locator("article", { has: page.getByRole("link", { exact: true, name: "Review" }) })
    .first()
    .getByRole("link", { exact: true, name: "Review" })
    .click();
  await expect(page).toHaveURL(/\/review#review-demo-review-/);
  await expect(page.getByRole("heading", { exact: true, name: "Review queue" })).toBeVisible();

  await page.goto("/agent-inbox");
  await page.getByRole("link", { name: /Open transaction for/i }).first().click();
  await expect(page).toHaveURL(/\/transactions\/t\d+/);
  await expect(page.getByLabel("Read-only transaction details")).toBeVisible();
  await expectNoSensitiveFinanceText(page);
});

test("audit, settings, and agent inbox expose accessible names for controls", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });

  await page.goto("/audit");
  await expect(page.getByRole("heading", { exact: true, name: "Advanced audit" })).toBeVisible();
  await expect(page.getByLabel("From")).toHaveAttribute("type", "date");
  await expect(page.getByLabel("To")).toHaveAttribute("type", "date");

  await page.goto("/settings");
  await expect(page.getByRole("heading", { exact: true, name: "Settings" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /Sync on app open is (on|off)/ })).toBeDisabled();

  await page.goto("/agent-inbox");
  await expect(page.getByRole("heading", { exact: true, name: "Agent inbox" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Open transaction for/i }).first()).toBeVisible();
});

test("recurring and accounts pages render focused recurring rows and active accounts", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });

  await page.goto("/recurring");
  await expect(page.getByLabel("Recurring summary")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Next 30 days" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Add a recurring expense" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add recurring expense" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Recurring expenses" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Patterns from real transactions" })).toBeVisible();
  await expect(page.getByText("Demo recurring patterns are read-only")).toBeVisible();
  await expect(page.getByText("Equinox").first()).toBeVisible();
  await expect(page.getByText("Substack").first()).toBeVisible();
  await page.getByRole("button", { name: /adjust substack recurring details/i }).click();
  await expect(page.locator("select[name='cadence']")).toContainText("Annual");
  await expect(page.getByRole("button", { name: /read-only demo/i }).last()).toBeDisabled();
  const recurringReadOnlyButtons = page.getByRole("button", { name: /read-only demo/i });
  if (await recurringReadOnlyButtons.count()) {
    await expect(recurringReadOnlyButtons.first()).toBeDisabled();
  }
  await expectNoSensitiveFinanceText(page);
  await expectNoPageOverflow(page);

  await page.goto("/accounts");
  const connectedAccounts = page.getByLabel("Connected accounts");
  await expect(connectedAccounts).toContainText("Accounts with the newest recent transactions appear first.");
  await expect(connectedAccounts).toContainText("Schools First");
  await expect(connectedAccounts).toContainText("Chase");
  await expect(connectedAccounts).toContainText("Charles Schwab Checking");
  await expect(connectedAccounts).toContainText("Recent");
  await expect(connectedAccounts).toContainText("PAYROLL DEPOSIT");
  await expect(connectedAccounts).not.toContainText("Net balance");
  await expect(connectedAccounts).not.toContainText("No recent transactions");
  await expect(connectedAccounts).not.toContainText("Never synced");
  await expect(connectedAccounts).not.toContainText("No sync yet");
  await expect(page.getByLabel("Accounts summary")).toHaveCount(0);
  await expect(connectedAccounts.getByRole("link", { exact: true, name: "Manage connections" })).toHaveAttribute("href", "/settings");
  await expect(page.getByRole("button", { name: /^Sync$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /disconnect/i })).toHaveCount(0);
  await expect(page.getByLabel("Bank connections")).toHaveCount(0);
  await expectNoSensitiveFinanceText(page);
  await expectNoPageOverflow(page);

  const accountLinks = await connectedAccounts.getByRole("link", { name: /View transactions for/i }).evaluateAll((links) => (
    links.map((link) => ({
      href: link.getAttribute("href") ?? "",
      label: link.getAttribute("aria-label") ?? ""
    }))
  ));
  expect(accountLinks.length).toBeGreaterThan(1);
  await expect(connectedAccounts.getByRole("link", { exact: true, name: "View all" })).toHaveCount(5);
  const accountParams = new Set<string>();
  for (const accountLink of accountLinks) {
    expect(accountLink.href).toMatch(/^\/transactions\?account=/);
    const accountParam = new URL(accountLink.href, "http://ledger.test").searchParams.get("account");
    expect(accountParam, accountLink.label).toBeTruthy();
    accountParams.add(accountParam!);

    await page.goto(accountLink.href);
    await expect(page).toHaveURL(new RegExp(`/transactions\\?account=${accountParam}`));
    await expect(page.getByRole("heading", { exact: true, name: "Transactions" })).toBeVisible();
    await expect(page.getByLabel("Active filters")).toContainText("Account:");
  }
  expect(accountParams.size).toBe(accountLinks.length);
});

test("audit page lists demo audit events with sanitized summaries", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/audit");

  await expect(page.getByRole("heading", { name: /advanced audit trail/i })).toBeVisible();
  await expect(page.getByText("Seed data loaded")).toBeVisible();
  await expect(page.getByText("AI suggestion accepted")).toBeVisible();
  await expect(page.getByText("Recurring candidate confirmed")).toBeVisible();
  await expect(page.getByText("Reimbursement linked")).toBeVisible();

  // Confirm no actual token values, raw Plaid payloads, or bearer headers leak through.
  // (The page copy intentionally mentions the words "tokens" and "authorization headers"
  //  to describe the redaction policy, so we look for value-shaped patterns instead.)
  const body = (await page.textContent("body")) ?? "";
  expect(body).not.toMatch(/access_token\s*[":=]/i);
  expect(body).not.toMatch(/raw_payload\s*[":=]/i);
  expect(body).not.toMatch(/Bearer\s+[A-Za-z0-9_.-]+/);
  expect(body).not.toMatch(/sk-[A-Za-z0-9]/);

  // Filter narrows the list
  await page.locator("select[name='group']").selectOption("seed-demo");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("Seed data loaded")).toBeVisible();
  await expect(page.getByText("AI suggestion accepted")).toHaveCount(0);
});

test("settings keeps bank connections and access controls simple", async ({ baseURL, context, page }) => {
  await enableDemoMode(context, baseURL!);
  await page.setViewportSize({ height: 900, width: 1440 });
  await page.goto("/settings");

  await expect(page.getByText("Bank connections", { exact: true })).toBeVisible();
  await expect(page.getByText("Demo mode uses seeded Plaid-style data")).toBeVisible();
  await expect(page.getByText("Demo mode keeps calendar integration off")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sync$/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /connect a bank with plaid/i })).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Read-only$/ }).first()).toBeDisabled();
  await expect(page.getByText("Last successful sync")).toBeVisible();
  await expect(page.getByText("Schools First FCU")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Access" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await expect(page.getByText("Environment", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Items", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Institutions", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Production mode imports real account balances")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Setup checklist" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Latest Plaid run" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Spending categories" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Saved category automation" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Suggestion status" })).toHaveCount(0);
  await expect(page.getByText(/OpenAI auto review|Manual AI ready|Fallback active/)).toHaveCount(0);

  await expectNoVisibleLegacyBrand(page);
  await expectNoSensitiveFinanceText(page);
  await expectNoPageOverflow(page);
});
