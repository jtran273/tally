import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clearDemoCookie } from "@/lib/demo/auth";
import { requireSameOriginRequest } from "@/lib/security/request";
import { NextResponse, type NextRequest } from "next/server";

type LocalSignOutClient = {
  auth: {
    signOut(options: { scope: "local" }): Promise<unknown>;
  };
};

export async function signOutCurrentSupabaseSession(supabase: LocalSignOutClient | null) {
  if (supabase) {
    await supabase.auth.signOut({ scope: "local" });
  }
}

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  const supabase = await createSupabaseServerClient();
  await signOutCurrentSupabaseSession(supabase);

  const redirectUrl = new URL("/login", request.url);
  redirectUrl.searchParams.set("signedOut", "1");

  const response = NextResponse.redirect(redirectUrl, { status: 303 });
  clearDemoCookie(response);

  return response;
}
