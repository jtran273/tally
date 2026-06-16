import assert from "node:assert/strict";
import test from "node:test";
import { getRequiredSupabaseConfig, getSupabaseConfig } from "./env";

const SUPABASE_ENV_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY"
] as const;

function withSupabaseEnv(env: Partial<Record<(typeof SUPABASE_ENV_KEYS)[number], string>>, run: () => void) {
  const previous = new Map(SUPABASE_ENV_KEYS.map((key) => [key, process.env[key]]));

  for (const key of SUPABASE_ENV_KEYS) {
    const value = env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    run();
  } finally {
    for (const key of SUPABASE_ENV_KEYS) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("getSupabaseConfig normalizes Supabase service paths to the project origin", () => {
  withSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co/rest/v1/",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key"
  }, () => {
    assert.equal(getSupabaseConfig()?.url, "https://example.supabase.co");
  });

  withSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co/auth/v1",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key"
  }, () => {
    assert.equal(getSupabaseConfig()?.url, "https://example.supabase.co");
  });
});

test("getSupabaseConfig accepts server-side Supabase aliases", () => {
  withSupabaseEnv({
    SUPABASE_URL: "https://server-alias.supabase.co",
    SUPABASE_ANON_KEY: "server-alias-anon-key"
  }, () => {
    assert.deepEqual(getSupabaseConfig(), {
      anonKey: "server-alias-anon-key",
      url: "https://server-alias.supabase.co"
    });
  });
});

test("getSupabaseConfig prefers public Supabase env names over aliases", () => {
  withSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://public-name.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
    SUPABASE_URL: "https://server-alias.supabase.co",
    SUPABASE_ANON_KEY: "server-alias-anon-key"
  }, () => {
    assert.deepEqual(getSupabaseConfig(), {
      anonKey: "public-anon-key",
      url: "https://public-name.supabase.co"
    });
  });
});

test("getSupabaseConfig does not mix public and alias Supabase env pairs", () => {
  withSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://public-name.supabase.co",
    SUPABASE_ANON_KEY: "server-alias-anon-key"
  }, () => {
    assert.equal(getSupabaseConfig(), null);
  });

  withSupabaseEnv({
    NEXT_PUBLIC_SUPABASE_URL: "https://stale-public-name.supabase.co",
    SUPABASE_URL: "https://server-alias.supabase.co",
    SUPABASE_ANON_KEY: "server-alias-anon-key"
  }, () => {
    assert.deepEqual(getSupabaseConfig(), {
      anonKey: "server-alias-anon-key",
      url: "https://server-alias.supabase.co"
    });
  });
});

test("getRequiredSupabaseConfig error lists both supported Supabase env names", () => {
  withSupabaseEnv({}, () => {
    assert.throws(
      () => getRequiredSupabaseConfig(),
      /NEXT_PUBLIC_SUPABASE_URL\/SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY\/SUPABASE_ANON_KEY/
    );
  });
});
