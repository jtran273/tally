import assert from "node:assert/strict";
import test from "node:test";
import { PlaidConfigurationError } from "./config";
import { decryptPlaidAccessToken, encryptPlaidAccessToken, PlaidTokenDecryptionError } from "./token-vault";

const ENV_KEYS = [
  "NEXT_PUBLIC_APP_URL",
  "NODE_ENV",
  "PLAID_CLIENT_ID",
  "PLAID_ENV",
  "PLAID_PRODUCTION_SECRET",
  "PLAID_REDIRECT_URI",
  "PLAID_SANDBOX_SECRET",
  "PLAID_SECRET",
  "PLAID_TOKEN_ENCRYPTION_KEY",
  "VERCEL_ENV",
  "VERCEL_URL"
] as const;

function withTokenVaultEnv(
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
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  PLAID_CLIENT_ID: "client-id",
  PLAID_ENV: "production",
  PLAID_PRODUCTION_SECRET: "production-secret",
  PLAID_REDIRECT_URI: undefined,
  PLAID_SANDBOX_SECRET: undefined,
  PLAID_SECRET: undefined,
  VERCEL_URL: undefined
} satisfies Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

test("explicit Plaid token encryption key does not require Link redirect config during decrypt", () => {
  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "production",
    PLAID_TOKEN_ENCRYPTION_KEY: "stable-token-key",
    VERCEL_ENV: "production"
  }, () => {
    const ciphertext = encryptPlaidAccessToken("access-production-123");

    assert.equal(decryptPlaidAccessToken(ciphertext), "access-production-123");
  });
});

test("explicit Plaid token encryption key survives Plaid secret changes", () => {
  let ciphertext = "";

  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "production",
    PLAID_PRODUCTION_SECRET: "original-production-secret",
    PLAID_TOKEN_ENCRYPTION_KEY: "stable-token-key",
    VERCEL_ENV: "production"
  }, () => {
    ciphertext = encryptPlaidAccessToken("access-production-123");
  });

  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "production",
    PLAID_PRODUCTION_SECRET: "rotated-production-secret",
    PLAID_TOKEN_ENCRYPTION_KEY: "stable-token-key",
    VERCEL_ENV: "production"
  }, () => {
    assert.equal(decryptPlaidAccessToken(ciphertext), "access-production-123");
  });
});

test("legacy Plaid token key uses credentials without requiring Link redirect config", () => {
  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "development",
    PLAID_ENV: "sandbox",
    PLAID_PRODUCTION_SECRET: undefined,
    PLAID_SANDBOX_SECRET: "sandbox-secret",
    PLAID_TOKEN_ENCRYPTION_KEY: undefined,
    VERCEL_ENV: undefined
  }, () => {
    const ciphertext = encryptPlaidAccessToken("access-legacy-123");

    assert.equal(decryptPlaidAccessToken(ciphertext), "access-legacy-123");
  });
});

test("Plaid token decryption can read legacy ciphertext in production after explicit key is configured", () => {
  let ciphertext = "";

  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "development",
    PLAID_ENV: "sandbox",
    PLAID_PRODUCTION_SECRET: undefined,
    PLAID_SANDBOX_SECRET: "production-secret",
    PLAID_TOKEN_ENCRYPTION_KEY: undefined,
    VERCEL_ENV: undefined
  }, () => {
    ciphertext = encryptPlaidAccessToken("access-production-legacy");
  });

  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "production",
    PLAID_TOKEN_ENCRYPTION_KEY: "stable-token-key",
    VERCEL_ENV: "production"
  }, () => {
    assert.equal(decryptPlaidAccessToken(ciphertext), "access-production-legacy");
  });
});

test("Plaid token decryption can read legacy ciphertext made with generic Plaid secret after scoped secret is added", () => {
  let ciphertext = "";

  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "development",
    PLAID_ENV: "sandbox",
    PLAID_PRODUCTION_SECRET: undefined,
    PLAID_SANDBOX_SECRET: undefined,
    PLAID_SECRET: "legacy-generic-production-secret",
    PLAID_TOKEN_ENCRYPTION_KEY: undefined,
    VERCEL_ENV: undefined
  }, () => {
    ciphertext = encryptPlaidAccessToken("access-production-legacy-generic");
  });

  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "production",
    PLAID_PRODUCTION_SECRET: "new-scoped-production-secret",
    PLAID_SECRET: "legacy-generic-production-secret",
    PLAID_TOKEN_ENCRYPTION_KEY: "stable-token-key",
    VERCEL_ENV: "production"
  }, () => {
    assert.equal(decryptPlaidAccessToken(ciphertext), "access-production-legacy-generic");
  });
});

test("Plaid token decryption tolerates missing Plaid credentials when an explicit key is set", () => {
  let ciphertext = "";

  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "production",
    PLAID_TOKEN_ENCRYPTION_KEY: "rotated-key",
    VERCEL_ENV: "production"
  }, () => {
    ciphertext = encryptPlaidAccessToken("rotated-access-token");
  });

  withTokenVaultEnv({
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
    NODE_ENV: "production",
    PLAID_CLIENT_ID: undefined,
    PLAID_ENV: undefined,
    PLAID_PRODUCTION_SECRET: undefined,
    PLAID_REDIRECT_URI: undefined,
    PLAID_SANDBOX_SECRET: undefined,
    PLAID_SECRET: undefined,
    PLAID_TOKEN_ENCRYPTION_KEY: "rotated-key",
    VERCEL_ENV: "production",
    VERCEL_URL: undefined
  }, () => {
    assert.equal(decryptPlaidAccessToken(ciphertext), "rotated-access-token");
  });
});

test("Plaid token encryption still requires explicit key material in production", () => {
  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "production",
    PLAID_TOKEN_ENCRYPTION_KEY: undefined,
    VERCEL_ENV: "production"
  }, () => {
    assert.throws(
      () => encryptPlaidAccessToken("access-token"),
      (error) => error instanceof PlaidConfigurationError
        && error.message.includes("PLAID_TOKEN_ENCRYPTION_KEY is required when PLAID_ENV=production")
    );
  });
});

test("Plaid token encryption requires explicit key material when Plaid environment is production", () => {
  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "development",
    PLAID_PRODUCTION_SECRET: undefined,
    PLAID_SECRET: "sandbox-secret",
    PLAID_TOKEN_ENCRYPTION_KEY: undefined,
    VERCEL_ENV: undefined
  }, () => {
    assert.throws(
      () => encryptPlaidAccessToken("access-token"),
      (error) => error instanceof PlaidConfigurationError
        && error.message.includes("PLAID_TOKEN_ENCRYPTION_KEY is required when PLAID_ENV=production")
    );
  });
});

test("Plaid token decryption can read legacy production ciphertext locally without explicit key material", () => {
  let ciphertext = "";

  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "development",
    PLAID_ENV: "sandbox",
    PLAID_PRODUCTION_SECRET: undefined,
    PLAID_SANDBOX_SECRET: "sandbox-secret",
    PLAID_TOKEN_ENCRYPTION_KEY: undefined,
    VERCEL_ENV: undefined
  }, () => {
    ciphertext = encryptPlaidAccessToken("access-legacy-123");
  });

  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "development",
    PLAID_PRODUCTION_SECRET: undefined,
    PLAID_SECRET: "sandbox-secret",
    PLAID_TOKEN_ENCRYPTION_KEY: undefined,
    VERCEL_ENV: undefined
  }, () => {
    assert.equal(decryptPlaidAccessToken(ciphertext), "access-legacy-123");
  });
});

test("Plaid token decryption requires explicit key material in production runtime", () => {
  let ciphertext = "";

  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "development",
    PLAID_ENV: "sandbox",
    PLAID_PRODUCTION_SECRET: undefined,
    PLAID_SANDBOX_SECRET: "sandbox-secret",
    PLAID_TOKEN_ENCRYPTION_KEY: undefined,
    VERCEL_ENV: undefined
  }, () => {
    ciphertext = encryptPlaidAccessToken("access-legacy-123");
  });

  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "production",
    PLAID_TOKEN_ENCRYPTION_KEY: undefined,
    VERCEL_ENV: "production"
  }, () => {
    assert.throws(
      () => decryptPlaidAccessToken(ciphertext),
      (error) => error instanceof PlaidConfigurationError
        && error.message.includes("PLAID_TOKEN_ENCRYPTION_KEY is required when PLAID_ENV=production")
    );
  });
});

test("unsupported Plaid token ciphertext is treated as a token decryption failure", () => {
  withTokenVaultEnv({
    ...baseEnv,
    NODE_ENV: "production",
    PLAID_TOKEN_ENCRYPTION_KEY: "stable-token-key",
    VERCEL_ENV: "production"
  }, () => {
    assert.throws(
      () => decryptPlaidAccessToken("revoked"),
      PlaidTokenDecryptionError
    );
  });
});
