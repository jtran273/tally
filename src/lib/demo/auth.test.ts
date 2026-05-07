import assert from "node:assert/strict";
import test from "node:test";
import { isDemoModeEnabled } from "./auth";

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

test("demo mode is enabled by default in production", () => {
  mutableEnv.NODE_ENV = "production";
  delete mutableEnv.VERCEL_ENV;
  delete mutableEnv.ENABLE_DEMO_MODE;

  assert.equal(isDemoModeEnabled(), true);
});

test("demo mode is enabled by default on Vercel preview builds", () => {
  mutableEnv.NODE_ENV = "production";
  mutableEnv.VERCEL_ENV = "preview";
  delete mutableEnv.ENABLE_DEMO_MODE;

  assert.equal(isDemoModeEnabled(), true);
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
