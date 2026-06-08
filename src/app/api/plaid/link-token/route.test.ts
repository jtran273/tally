import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route";
import { crossOriginPlaidRequest } from "../route-test-utils";

test("Plaid link-token rejects cross-origin requests", async () => {
  const response = await POST(crossOriginPlaidRequest("/api/plaid/link-token"));
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Invalid request origin." });
});
