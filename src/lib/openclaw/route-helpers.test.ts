import assert from "node:assert/strict";
import test from "node:test";
import type { NextRequest } from "next/server";
import {
  isAuthorizedOpenClawRequest,
  requireOpenClawAuth
} from "./route-helpers";

const originalToken = process.env.OPENCLAW_TOKEN;

test.afterEach(() => {
  if (originalToken === undefined) {
    delete process.env.OPENCLAW_TOKEN;
  } else {
    process.env.OPENCLAW_TOKEN = originalToken;
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
