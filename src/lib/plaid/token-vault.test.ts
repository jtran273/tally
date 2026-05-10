import assert from "node:assert/strict";
import test from "node:test";
import { decryptPlaidAccessToken, encryptPlaidAccessToken } from "./token-vault";

const ENV_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "NODE_ENV",
  "PLAID_CLIENT_ID",
  "PLAID_ENV",
  "PLAID_PRODUCTION_SECRET",
  "PLAID_REDIRECT_URI",
  "PLAID_SECRET",
  "PLAID_TOKEN_ENCRYPTION_KEY",
  "VERCEL_ENV",
  "VERCEL_URL"
] as const;

function withEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, callback: () => void) {
  const previous = new Map<string, string | undefined>();
  for (const key of ENV_KEYS) {
    previous.set(key, process.env[key]);
    const value = values[key];
    if (value === undefined) {
      delete process.env[key as string];
    } else {
      process.env[key as string] = value;
    }
  }

  try {
    callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key as string];
      } else {
        process.env[key as string] = value;
      }
    }
  }
}

test("explicit Plaid token encryption key does not require Link redirect config during decrypt", () => {
  withEnv({
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NODE_ENV: "production",
    PLAID_CLIENT_ID: "client-id",
    PLAID_ENV: "production",
    PLAID_PRODUCTION_SECRET: "production-secret",
    PLAID_REDIRECT_URI: undefined,
    PLAID_SECRET: undefined,
    PLAID_TOKEN_ENCRYPTION_KEY: "stable-token-key",
    VERCEL_ENV: "production",
    VERCEL_URL: undefined
  }, () => {
    const ciphertext = encryptPlaidAccessToken("access-production-123");

    assert.equal(decryptPlaidAccessToken(ciphertext), "access-production-123");
  });
});

test("legacy Plaid token key uses credentials without requiring Link redirect config", () => {
  withEnv({
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NODE_ENV: "development",
    PLAID_CLIENT_ID: "client-id",
    PLAID_ENV: "production",
    PLAID_PRODUCTION_SECRET: "production-secret",
    PLAID_REDIRECT_URI: undefined,
    PLAID_SECRET: undefined,
    PLAID_TOKEN_ENCRYPTION_KEY: undefined,
    VERCEL_ENV: undefined,
    VERCEL_URL: undefined
  }, () => {
    const ciphertext = encryptPlaidAccessToken("access-legacy-123");

    assert.equal(decryptPlaidAccessToken(ciphertext), "access-legacy-123");
  });
});
