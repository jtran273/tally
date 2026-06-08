import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";
import {
  OPENCLAW_TEST_TOKEN,
  configureOpenClawServer,
  configureOpenClawTokenOnly,
  openClawRequest,
  restoreOpenClawEnv,
  saveOpenClawEnv
} from "../route-test-utils";

const PATH = "/api/openclaw/query";

test.beforeEach(saveOpenClawEnv);
test.afterEach(restoreOpenClawEnv);

test("OpenClaw query rejects unauthorized callers", async () => {
  configureOpenClawServer();
  const response = await POST(
    openClawRequest(PATH, { method: "POST", token: "wrong-token", body: { intent: "recent_transactions" } })
  );
  assert.equal(response.status, 401);
});

test("OpenClaw query rejects an unknown intent", async () => {
  configureOpenClawServer();
  const response = await POST(
    openClawRequest(PATH, { method: "POST", token: OPENCLAW_TEST_TOKEN, body: { intent: "nonsense" } })
  );
  assert.equal(response.status, 400);
});

test("OpenClaw query rejects a malformed JSON body", async () => {
  configureOpenClawServer();
  const response = await POST(
    openClawRequest(PATH, { method: "POST", token: OPENCLAW_TEST_TOKEN, rawBody: "{ not json" })
  );
  assert.equal(response.status, 400);
});

test("OpenClaw query reports missing server configuration", async () => {
  configureOpenClawTokenOnly();
  const response = await POST(
    openClawRequest(PATH, { method: "POST", token: OPENCLAW_TEST_TOKEN, body: { intent: "recent_transactions" } })
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
