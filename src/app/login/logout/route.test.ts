import assert from "node:assert/strict";
import test from "node:test";
import { signOutCurrentSupabaseSession } from "./route";

test("Supabase logout uses local session scope", async () => {
  let receivedOptions: unknown = null;

  await signOutCurrentSupabaseSession({
    auth: {
      async signOut(options) {
        receivedOptions = options;
      }
    }
  });

  assert.deepEqual(receivedOptions, { scope: "local" });
});

test("Supabase logout allows missing Supabase configuration", async () => {
  await signOutCurrentSupabaseSession(null);
});
