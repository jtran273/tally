import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isDemoRequest } from "@/lib/demo/auth";
import { getSupabaseConfig } from "./env";

const PUBLIC_PATHS = ["/login"];

// Default-deny: every route handled by an alternate auth scheme (cron bearer,
// OpenClaw bearer, OAuth state cookie) must be listed here explicitly. Adding a
// new such route requires editing this list, which forces a deliberate review
// of how the route authenticates callers.
const SESSION_BYPASS_PATHS = [
  "/api/agents/proactive-scan/scheduled",
  "/api/calendar/callback",
  "/api/openclaw/anomaly-alerts/scheduled",
  "/api/openclaw/briefing/scheduled",
  "/api/openclaw/outbox",
  "/api/openclaw/plaid-refresh",
  "/api/openclaw/query",
  "/api/openclaw/recent-transactions",
  "/api/openclaw/reimbursements",
  "/api/openclaw/replies",
  "/api/openclaw/review-items",
  "/api/openclaw/safe-to-spend",
  "/api/openclaw/signals",
  "/api/plaid/sync/scheduled"
];

function normalizePathname(pathname: string) {
  // Reject percent-encoded slashes so an attacker cannot smuggle path segments
  // past the allowlist check via "/api/openclaw/query%2f..%2fadmin".
  if (/%2f/i.test(pathname)) {
    return null;
  }
  return pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
}

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isSessionBypassPath(pathname: string) {
  return SESSION_BYPASS_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function buildLoginRedirect(request: NextRequest) {
  const redirectUrl = request.nextUrl.clone();
  const redirectedFrom = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  redirectUrl.pathname = "/login";
  redirectUrl.search = "";

  if (redirectedFrom !== "/") {
    redirectUrl.searchParams.set("redirectedFrom", redirectedFrom);
  }

  return redirectUrl;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });
  const rawPathname = request.nextUrl.pathname;
  const pathname = normalizePathname(rawPathname);

  if (pathname === null) {
    return NextResponse.redirect(buildLoginRedirect(request));
  }

  if (isPublicPath(pathname) || isSessionBypassPath(pathname)) {
    return supabaseResponse;
  }

  if (isDemoRequest(request)) {
    return supabaseResponse;
  }

  const config = getSupabaseConfig();

  if (!config) {
    return NextResponse.redirect(buildLoginRedirect(request));
  }

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, options, value }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      }
    }
  });

  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(buildLoginRedirect(request));
  }

  return supabaseResponse;
}
