import assert from "node:assert/strict";
import test from "node:test";
import { PATCH } from "./route";
// Imported across the [connectionId] dynamic-route folder. Tests cannot live
// inside that folder because the node test runner treats the bracketed path as
// a glob pattern and silently skips it, so the DELETE test is hosted here.
import { DELETE } from "./[connectionId]/route";
import { crossOriginPlaidRequest } from "../route-test-utils";

test("Plaid connections PATCH rejects cross-origin requests", async () => {
  const response = await PATCH(crossOriginPlaidRequest("/api/plaid/connections", "PATCH"));
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Invalid request origin." });
});

test("Plaid connection DELETE rejects cross-origin requests", async () => {
  const response = await DELETE(
    crossOriginPlaidRequest("/api/plaid/connections/abc", "DELETE"),
    { params: Promise.resolve({ connectionId: "abc" }) }
  );
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Invalid request origin." });
});
