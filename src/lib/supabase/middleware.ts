import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { isDemoRequest } from "@/lib/demo/auth";
import { getSupabaseConfig } from "./env";

const PUBLIC_PATHS = ["/login"];
const SESSION_BYPASS_PATHS = [
  "/api/agents/proactive-scan/scheduled",
  "/api/calendar/callback",
  "/api/openclaw",
  "/api/plaid/sync/scheduled"
];

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
  const pathname = request.nextUrl.pathname;

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
