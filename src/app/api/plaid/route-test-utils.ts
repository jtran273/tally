import { NextRequest } from "next/server";

// Shared helper for Plaid API route tests. Not a `*.test.ts` (so the runner
// does not execute it) and not a Next.js route file (so it is never bundled).

// A request from a foreign origin. Every state-changing Plaid route calls
// requireSameOriginRequest first, so this must be rejected with 403 before any
// auth, demo, or database work happens.
export function crossOriginPlaidRequest(path: string, method = "POST") {
  return new NextRequest(`http://localhost${path}`, {
    headers: { origin: "https://attacker.example.com" },
    method
  });
}
