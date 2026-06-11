import assert from "node:assert/strict";
import test from "node:test";
import type { NextRequest } from "next/server";
import { isAuthorizedMonthlyBudgetProposalScheduleRequest, POST } from "./route";

const originalCronSecret = process.env.CRON_SECRET;
const originalEnabled = process.env.MONTHLY_BUDGET_PROPOSAL_ENABLED;
const originalUserId = process.env.MONTHLY_BUDGET_PROPOSAL_USER_ID;
const originalOpenClawUserId = process.env.OPENCLAW_USER_ID;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

test.afterEach(() => {
  restoreEnv("CRON_SECRET", originalCronSecret);
  restoreEnv("MONTHLY_BUDGET_PROPOSAL_ENABLED", originalEnabled);
  restoreEnv("MONTHLY_BUDGET_PROPOSAL_USER_ID", originalUserId);
  restoreEnv("OPENCLAW_USER_ID", originalOpenClawUserId);
  restoreEnv("SUPABASE_SERVICE_ROLE_KEY", originalServiceRoleKey);
});

function scheduledRequest() {
  return new Request("http://localhost/api/agents/monthly-budget-proposal/scheduled", {
    headers: {
      authorization: "Bearer test-cron-secret"
    },
    method: "POST"
  }) as NextRequest;
}

test("scheduled monthly budget proposal auth requires CRON_SECRET bearer token", () => {
  process.env.CRON_SECRET = "test-cron-secret";

  assert.equal(isAuthorizedMonthlyBudgetProposalScheduleRequest(new Headers()), false);
  assert.equal(
    isAuthorizedMonthlyBudgetProposalScheduleRequest(new Headers({ authorization: "Bearer wrong" })),
    false
  );
  assert.equal(
    isAuthorizedMonthlyBudgetProposalScheduleRequest(new Headers({ authorization: "Bearer test-cron-secret" })),
    true
  );
});

test("scheduled monthly budget proposal rejects unauthorized requests", async () => {
  process.env.CRON_SECRET = "test-cron-secret";

  const request = new Request("http://localhost/api/agents/monthly-budget-proposal/scheduled", {
    method: "POST"
  }) as NextRequest;
  const response = await POST(request);

  assert.equal(response.status, 401);
});

test("scheduled monthly budget proposal returns a disabled run unless explicitly enabled", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.MONTHLY_BUDGET_PROPOSAL_ENABLED;

  const response = await POST(scheduledRequest());
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.run.status, "disabled");
  assert.equal(body.run.proposal, null);
});

test("scheduled monthly budget proposal reports missing configuration without leaking details", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  process.env.MONTHLY_BUDGET_PROPOSAL_ENABLED = "true";
  delete process.env.MONTHLY_BUDGET_PROPOSAL_USER_ID;
  delete process.env.OPENCLAW_USER_ID;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  const response = await POST(scheduledRequest());
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.error, "Monthly budget proposal run is not configured.");
});

test("Vercel cron GET invocations share the POST auth gate and disabled behavior", async () => {
  process.env.CRON_SECRET = "test-cron-secret";
  delete process.env.MONTHLY_BUDGET_PROPOSAL_ENABLED;

  const { GET } = await import("./route");

  const unauthorized = await GET(new Request("http://localhost/api/agents/monthly-budget-proposal/scheduled", {
    method: "GET"
  }) as NextRequest);
  assert.equal(unauthorized.status, 401);

  const response = await GET(new Request("http://localhost/api/agents/monthly-budget-proposal/scheduled", {
    headers: { authorization: "Bearer test-cron-secret" },
    method: "GET"
  }) as NextRequest);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.run.status, "disabled");
});
