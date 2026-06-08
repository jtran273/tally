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

const PATH = "/api/openclaw/recent-transactions";

test.beforeEach(saveOpenClawEnv);
test.afterEach(restoreOpenClawEnv);

test("OpenClaw recent-transactions rejects unauthorized callers", async () => {
  configureOpenClawServer();
  const response = await GET(openClawRequest(PATH, { token: "wrong-token" }));
  assert.equal(response.status, 401);
});

test("OpenClaw recent-transactions rejects an invalid limit", async () => {
  configureOpenClawServer();
  const response = await GET(openClawRequest(`${PATH}?limit=abc`, { token: OPENCLAW_TEST_TOKEN }));
  assert.equal(response.status, 400);
});

test("OpenClaw recent-transactions reports missing server configuration", async () => {
  configureOpenClawTokenOnly();
  const response = await GET(openClawRequest(PATH, { token: OPENCLAW_TEST_TOKEN }));
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
