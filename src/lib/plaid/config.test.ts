import assert from "node:assert/strict";
import test from "node:test";
import { getPlaidConfig, getPlaidLinkTokenConfig, PlaidConfigurationError } from "./config";

const ENV_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "NODE_ENV",
  "PLAID_CLIENT_ID",
  "PLAID_ENV",
  "PLAID_PRODUCTION_SECRET",
  "PLAID_REDIRECT_URI",
  "PLAID_SANDBOX_SECRET",
  "PLAID_SECRET",
  "VERCEL_ENV",
  "VERCEL_URL"
] as const;

const mutableEnv = process.env as Record<string, string | undefined>;

function withPlaidEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>, fn: () => void) {
  const previous = new Map(ENV_KEYS.map((key) => [key, mutableEnv[key]]));

  for (const key of ENV_KEYS) {
    const value = values[key];
    if (value === undefined) {
      delete mutableEnv[key];
    } else {
      mutableEnv[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete mutableEnv[key];
      } else {
        mutableEnv[key] = value;
      }
    }
  }
}

test("Plaid runtime config does not require redirect URI validity for sync-only operations", () => {
  withPlaidEnv({
    NEXT_PUBLIC_APP_URL: undefined,
    PLAID_CLIENT_ID: "client-id",
    PLAID_ENV: "production",
    PLAID_PRODUCTION_SECRET: "production-secret",
    PLAID_REDIRECT_URI: "http://localhost:3000/settings",
    PLAID_SANDBOX_SECRET: undefined,
    PLAID_SECRET: undefined,
    VERCEL_URL: undefined
  }, () => {
    const config = getPlaidConfig();

    assert.equal(config.environment, "production");
    assert.equal(config.redirectUri, "http://localhost:3000/settings");
  });
});

test("Plaid Link token config omits localhost HTTP redirect URI in production", () => {
  withPlaidEnv({
    NEXT_PUBLIC_APP_URL: undefined,
    PLAID_CLIENT_ID: "client-id",
    PLAID_ENV: "production",
    PLAID_PRODUCTION_SECRET: "production-secret",
    PLAID_REDIRECT_URI: "http://localhost:3000/settings",
    PLAID_SANDBOX_SECRET: undefined,
    PLAID_SECRET: undefined,
    VERCEL_URL: undefined
  }, () => {
    const config = getPlaidLinkTokenConfig();

    assert.equal(config.environment, "production");
    assert.equal(config.redirectUri, null);
  });
});

test("Plaid Link token config keeps explicit local redirect outside production", () => {
  withPlaidEnv({
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    PLAID_CLIENT_ID: "client-id",
    PLAID_ENV: "sandbox",
    PLAID_PRODUCTION_SECRET: undefined,
    PLAID_REDIRECT_URI: "http://localhost:3000/settings",
    PLAID_SANDBOX_SECRET: "sandbox-secret",
    PLAID_SECRET: undefined,
    VERCEL_URL: undefined
  }, () => {
    const config = getPlaidLinkTokenConfig();

    assert.equal(config.environment, "sandbox");
    assert.equal(config.redirectUri, "http://localhost:3000/settings");
  });
});

test("Plaid Link token config does not replace local production redirect with app URL", () => {
  withPlaidEnv({
    NEXT_PUBLIC_APP_URL: "https://ledger.example.com",
    PLAID_CLIENT_ID: "client-id",
    PLAID_ENV: "production",
    PLAID_PRODUCTION_SECRET: "production-secret",
    PLAID_REDIRECT_URI: "http://localhost:3000/settings",
    PLAID_SANDBOX_SECRET: undefined,
    PLAID_SECRET: undefined,
    VERCEL_URL: "personal-finance-os-jtran273s-projects.vercel.app"
  }, () => {
    const config = getPlaidLinkTokenConfig();

    assert.equal(config.environment, "production");
    assert.equal(config.redirectUri, null);
  });
});

test("Plaid Link token config uses explicit registered HTTPS redirect URI in production", () => {
  withPlaidEnv({
    NEXT_PUBLIC_APP_URL: "https://wrong.example.com",
    PLAID_CLIENT_ID: "client-id",
    PLAID_ENV: "production",
    PLAID_PRODUCTION_SECRET: "production-secret",
    PLAID_REDIRECT_URI: "https://ledger.example.com/settings",
    PLAID_SANDBOX_SECRET: undefined,
    PLAID_SECRET: undefined,
    VERCEL_URL: "personal-finance-os-jtran273s-projects.vercel.app"
  }, () => {
    const config = getPlaidLinkTokenConfig();

    assert.equal(config.environment, "production");
    assert.equal(config.redirectUri, "https://ledger.example.com/settings");
  });
});

test("Plaid Link token config does not use Vercel or app URL as production redirect fallback", () => {
  withPlaidEnv({
    NEXT_PUBLIC_APP_URL: "https://personal-finance-os-lac.vercel.app",
    PLAID_CLIENT_ID: "client-id",
    PLAID_ENV: "production",
    PLAID_PRODUCTION_SECRET: "production-secret",
    PLAID_REDIRECT_URI: undefined,
    PLAID_SANDBOX_SECRET: undefined,
    PLAID_SECRET: undefined,
    VERCEL_URL: "personal-finance-random-jtran273s-projects.vercel.app"
  }, () => {
    const config = getPlaidLinkTokenConfig();

    assert.equal(config.environment, "production");
    assert.equal(config.redirectUri, null);
  });
});

test("Plaid config rejects an empty PLAID_ENV in a production runtime", () => {
  withPlaidEnv({
    NODE_ENV: "production",
    PLAID_CLIENT_ID: "client-id",
    PLAID_ENV: "",
    PLAID_PRODUCTION_SECRET: "production-secret",
    PLAID_SECRET: "fallback-secret",
    VERCEL_ENV: "production"
  }, () => {
    assert.throws(
      () => getPlaidConfig(),
      (error) => error instanceof PlaidConfigurationError
        && error.message.startsWith("PLAID_ENV must be set to sandbox or production. It is empty")
    );
  });
});

test("Plaid config defaults to sandbox when PLAID_ENV is empty outside a production runtime", () => {
  withPlaidEnv({
    NODE_ENV: "development",
    PLAID_CLIENT_ID: "client-id",
    PLAID_ENV: "",
    PLAID_SANDBOX_SECRET: "sandbox-secret",
    VERCEL_ENV: undefined
  }, () => {
    const config = getPlaidConfig();

    assert.equal(config.environment, "sandbox");
  });
});

test("Plaid Link token config still rejects non-local HTTP redirect URI in production", () => {
  withPlaidEnv({
    NEXT_PUBLIC_APP_URL: undefined,
    PLAID_CLIENT_ID: "client-id",
    PLAID_ENV: "production",
    PLAID_PRODUCTION_SECRET: "production-secret",
    PLAID_REDIRECT_URI: "http://example.com/settings",
    PLAID_SANDBOX_SECRET: undefined,
    PLAID_SECRET: undefined,
    VERCEL_URL: undefined
  }, () => {
    assert.throws(
      () => getPlaidLinkTokenConfig(),
      (error) => error instanceof PlaidConfigurationError
        && error.message === "Plaid production redirect URI must use HTTPS."
    );
  });
});
