import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import {
  getRequestOrigin,
  isAuthorizedBearerToken,
  requireSameOriginReadRequest
} from "./request";

const originalNodeEnv = process.env.NODE_ENV;
const mutableEnv = process.env as Record<string, string | undefined>;

test.afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete mutableEnv.NODE_ENV;
  } else {
    mutableEnv.NODE_ENV = originalNodeEnv;
  }
});

test("bearer auth helper requires the configured token", () => {
  assert.equal(isAuthorizedBearerToken(new Headers(), "secret-token"), false);
  assert.equal(isAuthorizedBearerToken(new Headers({ authorization: "Bearer wrong" }), "secret-token"), false);
  assert.equal(isAuthorizedBearerToken(new Headers({ authorization: "Bearer secret-token" }), "secret-token"), true);
});

test("request origin helper preserves the browser-facing host", () => {
  const request = new NextRequest("http://localhost:3000/login/demo", {
    headers: {
      host: "192.168.1.150:3000",
      "x-forwarded-proto": "http"
    }
  });

  assert.equal(getRequestOrigin(request), "http://192.168.1.150:3000");
});

test("same-origin read helper rejects cross-site fetches", async () => {
  const response = requireSameOriginReadRequest(new NextRequest("https://ledger.example/api/export/transactions", {
    headers: {
      "sec-fetch-site": "cross-site"
    }
  }));

  assert(response);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Invalid request origin." });
});

test("same-origin read helper allows same-origin browser reads", () => {
  const response = requireSameOriginReadRequest(new NextRequest("https://ledger.example/api/export/transactions", {
    headers: {
      "sec-fetch-site": "same-origin"
    }
  }));

  assert.equal(response, null);
});

test("same-origin read helper rejects missing origin metadata in production", async () => {
  mutableEnv.NODE_ENV = "production";

  const response = requireSameOriginReadRequest(new NextRequest("https://ledger.example/api/export/transactions"));

  assert(response);
  assert.equal(response.status, 403);
});
