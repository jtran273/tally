import assert from "node:assert/strict";
import test from "node:test";
import { decryptGoogleCalendarToken, encryptGoogleCalendarToken } from "./token-vault";

const ENV_KEYS = [
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "GOOGLE_CALENDAR_REDIRECT_URI",
  "GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY",
  "NEXT_PUBLIC_APP_URL",
  "NODE_ENV",
  "VERCEL_ENV"
] as const;

function withCalendarTokenVaultEnv(
  values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
  fn: () => void
) {
  const env = process.env as Record<string, string | undefined>;
  const previous = new Map(ENV_KEYS.map((key) => [key, env[key]]));

  for (const key of ENV_KEYS) {
    const value = values[key];
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  try {
    fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete env[key];
      } else {
        env[key] = value;
      }
    }
  }
}

const baseEnv = {
  GOOGLE_CALENDAR_CLIENT_ID: "calendar-client",
  GOOGLE_CALENDAR_CLIENT_SECRET: "calendar-secret",
  GOOGLE_CALENDAR_REDIRECT_URI: "https://ledger.example.test/api/calendar/callback",
  NEXT_PUBLIC_APP_URL: undefined
} satisfies Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

test("explicit Google Calendar token key decrypts without OAuth redirect config", () => {
  withCalendarTokenVaultEnv({
    ...baseEnv,
    GOOGLE_CALENDAR_REDIRECT_URI: undefined,
    GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY: "stable-calendar-token-key",
    NEXT_PUBLIC_APP_URL: undefined,
    NODE_ENV: "production",
    VERCEL_ENV: "production"
  }, () => {
    const ciphertext = encryptGoogleCalendarToken("calendar-access-production-123");

    assert.equal(decryptGoogleCalendarToken(ciphertext), "calendar-access-production-123");
  });
});

test("Google Calendar token encryption still requires explicit key material in production", () => {
  withCalendarTokenVaultEnv({
    ...baseEnv,
    GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY: undefined,
    NODE_ENV: "production",
    VERCEL_ENV: "production"
  }, () => {
    assert.throws(
      () => encryptGoogleCalendarToken("calendar-access-token"),
      /GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY is required in production/
    );
  });
});

test("legacy Google Calendar token key uses OAuth credentials in local development", () => {
  withCalendarTokenVaultEnv({
    ...baseEnv,
    GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY: undefined,
    NODE_ENV: "development",
    VERCEL_ENV: undefined
  }, () => {
    const ciphertext = encryptGoogleCalendarToken("calendar-access-legacy-123");

    assert.equal(decryptGoogleCalendarToken(ciphertext), "calendar-access-legacy-123");
  });
});
