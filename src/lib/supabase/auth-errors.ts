import { AuthApiError } from "@supabase/supabase-js";
import { type NextRequest, type NextResponse } from "next/server";

export function isInvalidRefreshTokenAuthError(error: unknown) {
  if (!(error instanceof AuthApiError)) return false;

  const message = error.message.toLowerCase();
  return error.status === 400 && message.includes("refresh") && message.includes("token");
}

export function isSupabaseAuthCookieName(name: string) {
  return (
    name === "supabase-auth-token" ||
    name.startsWith("sb-") && name.includes("auth-token")
  );
}

export function clearSupabaseAuthCookies(response: NextResponse, request: NextRequest) {
  for (const cookie of request.cookies.getAll()) {
    if (!isSupabaseAuthCookieName(cookie.name)) continue;

    response.cookies.set(cookie.name, "", {
      maxAge: 0,
      path: "/"
    });
  }

  return response;
}
