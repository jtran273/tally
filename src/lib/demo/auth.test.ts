import assert from "node:assert/strict";
import test from "node:test";
import { NextResponse } from "next/server";
import { DEMO_COOKIE_MAX_AGE_SECONDS, DEMO_COOKIE_NAME, isDemoModeEnabled, setDemoCookie } from "./auth";

const originalNodeEnv = process.env.NODE_ENV;
const originalVercelEnv = process.env.VERCEL_ENV;
const originalDemoFlag = process.env.ENABLE_DEMO_MODE;
const mutableEnv = process.env as Record<string, string | undefined>;

function resetEnv() {
  if (originalNodeEnv === undefined) {
    delete mutableEnv.NODE_ENV;
  } else {
    mutableEnv.NODE_ENV = originalNodeEnv;
  }

  if (originalVercelEnv === undefined) {
    delete mutableEnv.VERCEL_ENV;
  } else {
    mutableEnv.VERCEL_ENV = originalVercelEnv;
  }

  if (originalDemoFlag === undefined) {
    delete mutableEnv.ENABLE_DEMO_MODE;
  } else {
    mutableEnv.ENABLE_DEMO_MODE = originalDemoFlag;
  }
}

test.afterEach(resetEnv);

test("demo mode is disabled by default in production", () => {
  mutableEnv.NODE_ENV = "production";
  delete mutableEnv.VERCEL_ENV;
  delete mutableEnv.ENABLE_DEMO_MODE;

  assert.equal(isDemoModeEnabled(), false);
});

test("demo mode is disabled by default on production builds unless explicitly enabled", () => {
  mutableEnv.NODE_ENV = "production";
  mutableEnv.VERCEL_ENV = "preview";
  delete mutableEnv.ENABLE_DEMO_MODE;

  assert.equal(isDemoModeEnabled(), false);
});

test("demo mode is enabled by default outside production", () => {
  mutableEnv.NODE_ENV = "development";
  delete mutableEnv.VERCEL_ENV;
  delete mutableEnv.ENABLE_DEMO_MODE;

  assert.equal(isDemoModeEnabled(), true);
});

test("ENABLE_DEMO_MODE explicitly controls demo mode", () => {
  mutableEnv.NODE_ENV = "production";
  mutableEnv.ENABLE_DEMO_MODE = "true";
  assert.equal(isDemoModeEnabled(), true);

  mutableEnv.ENABLE_DEMO_MODE = "false";
  assert.equal(isDemoModeEnabled(), false);
});

test("demo cookie persists for a longer same-device session", () => {
  const response = NextResponse.next();

  setDemoCookie(response);

  const setCookie = response.headers.get("set-cookie");
  assert.equal(DEMO_COOKIE_MAX_AGE_SECONDS, 60 * 60 * 24 * 30);
  assert.match(setCookie ?? "", new RegExp(`^${DEMO_COOKIE_NAME}=1;`));
  assert.match(setCookie ?? "", new RegExp(`Max-Age=${DEMO_COOKIE_MAX_AGE_SECONDS}`));
  assert.match(setCookie ?? "", /HttpOnly/);
  assert.match(setCookie ?? "", /SameSite=lax/i);
});
