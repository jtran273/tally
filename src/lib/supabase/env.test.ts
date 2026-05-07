import assert from "node:assert/strict";
import test from "node:test";
import { getSupabaseConfig } from "./env";

function withSupabaseEnv(url: string, run: () => void) {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  process.env.NEXT_PUBLIC_SUPABASE_URL = url;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";

  try {
    run();
  } finally {
    if (previousUrl === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
    }

    if (previousKey === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = previousKey;
    }
  }
}

test("getSupabaseConfig normalizes Supabase service paths to the project origin", () => {
  withSupabaseEnv("https://example.supabase.co/rest/v1/", () => {
    assert.equal(getSupabaseConfig()?.url, "https://example.supabase.co");
  });

  withSupabaseEnv("https://example.supabase.co/auth/v1", () => {
    assert.equal(getSupabaseConfig()?.url, "https://example.supabase.co");
  });
});
