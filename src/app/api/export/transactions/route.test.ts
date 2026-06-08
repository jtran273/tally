import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "./route";

test("Transaction export rejects cross-origin requests", async () => {
  const request = new NextRequest("http://localhost/api/export/transactions", {
    headers: { origin: "https://attacker.example.com" }
  });
  const response = await GET(request);
  assert.ok(response);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Invalid request origin." });
});
