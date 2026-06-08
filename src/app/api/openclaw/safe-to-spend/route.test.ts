import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "./route";
import {
  OPENCLAW_TEST_TOKEN,
  configureOpenClawServer,
  configureOpenClawTokenOnly,
  openClawRequest,
  restoreOpenClawEnv,
  saveOpenClawEnv
} from "../route-test-utils";

const PATH = "/api/openclaw/safe-to-spend";

test.beforeEach(saveOpenClawEnv);
test.afterEach(restoreOpenClawEnv);

test("OpenClaw safe-to-spend rejects unauthorized callers", async () => {
  configureOpenClawServer();
  const response = await GET(openClawRequest(PATH, { token: "wrong-token" }));
  assert.equal(response.status, 401);
});

test("OpenClaw safe-to-spend rejects an invalid amount", async () => {
  configureOpenClawServer();
  const response = await GET(openClawRequest(`${PATH}?amount=abc`, { token: OPENCLAW_TEST_TOKEN }));
  assert.equal(response.status, 400);
});

test("OpenClaw safe-to-spend reports missing server configuration", async () => {
  configureOpenClawTokenOnly();
  const response = await GET(openClawRequest(PATH, { token: OPENCLAW_TEST_TOKEN }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
