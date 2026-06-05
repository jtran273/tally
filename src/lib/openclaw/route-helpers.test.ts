import assert from "node:assert/strict";
import test from "node:test";
import type { NextRequest } from "next/server";
import {
  getConfiguredOpenClawUserId,
  isAuthorizedOpenClawRequest,
  isAuthorizedOpenClawPlaidRefreshRequest,
  OpenClawRouteConfigurationError,
  requireOpenClawAuth,
  requireOpenClawPlaidRefreshAuth
} from "./route-helpers";

const originalToken = process.env.OPENCLAW_TOKEN;
const originalPlaidRefreshToken = process.env.OPENCLAW_PLAID_REFRESH_TOKEN;
const originalUserId = process.env.OPENCLAW_USER_ID;

test.afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.OPENCLAW_TOKEN;
  } else {
    process.env.OPENCLAW_TOKEN = originalToken;
  }

  if (originalPlaidRefreshToken === undefined) {
    delete process.env.OPENCLAW_PLAID_REFRESH_TOKEN;
  } else {
    process.env.OPENCLAW_PLAID_REFRESH_TOKEN = originalPlaidRefreshToken;
  }

  if (originalUserId === undefined) {
    delete process.env.OPENCLAW_USER_ID;
  } else {
    process.env.OPENCLAW_USER_ID = originalUserId;
  }
});

test("OpenClaw bearer auth requires the configured token", () => {
  process.env.OPENCLAW_TOKEN = "test-openclaw-token";

  assert.equal(isAuthorizedOpenClawRequest(new Headers()), false);
  assert.equal(
    isAuthorizedOpenClawRequest(new Headers({ authorization: "Bearer wrong-token" })),
    false
  );
  assert.equal(
    isAuthorizedOpenClawRequest(new Headers({ authorization: "Bearer test-openclaw-token" })),
    true
  );
});

test("OpenClaw auth failure returns no-store 401 JSON", async () => {
  process.env.OPENCLAW_TOKEN = "test-openclaw-token";

  const response = requireOpenClawAuth({ headers: new Headers() } as NextRequest);

  assert(response);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(await response.json(), { error: "OpenClaw request is not authorized." });
});

test("OpenClaw Plaid refresh bearer auth requires the dedicated token", () => {
  process.env.OPENCLAW_PLAID_REFRESH_TOKEN = "test-openclaw-refresh-token";

  assert.equal(isAuthorizedOpenClawPlaidRefreshRequest(new Headers()), false);
  assert.equal(
    isAuthorizedOpenClawPlaidRefreshRequest(new Headers({ authorization: "Bearer wrong-token" })),
    false
  );
  assert.equal(
    isAuthorizedOpenClawPlaidRefreshRequest(
      new Headers({ authorization: "Bearer test-openclaw-refresh-token" })
    ),
    true
  );
});

test("OpenClaw Plaid refresh auth reports missing server configuration", async () => {
  delete process.env.OPENCLAW_PLAID_REFRESH_TOKEN;

  const response = requireOpenClawPlaidRefreshAuth({ headers: new Headers() } as NextRequest);

  assert(response);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { error: "OpenClaw Plaid refresh is not configured." });
});

test("OpenClaw Plaid refresh auth failure returns no-store 401 JSON", async () => {
  process.env.OPENCLAW_PLAID_REFRESH_TOKEN = "test-openclaw-refresh-token";

  const response = requireOpenClawPlaidRefreshAuth({ headers: new Headers() } as NextRequest);

  assert(response);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(await response.json(), { error: "OpenClaw Plaid refresh is not authorized." });
});

test("OpenClaw user id helper requires configured server scope", () => {
  process.env.OPENCLAW_USER_ID = "test-user-id";

  assert.equal(getConfiguredOpenClawUserId(), "test-user-id");

  delete process.env.OPENCLAW_USER_ID;
  assert.throws(() => getConfiguredOpenClawUserId(), OpenClawRouteConfigurationError);
});
