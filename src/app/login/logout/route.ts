import { createSupabaseServerClient } from "@/lib/supabase/server";
import { clearDemoCookie } from "@/lib/demo/auth";
import { requireSameOriginRequest } from "@/lib/security/request";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  const supabase = await createSupabaseServerClient();

  if (supabase) {
    await supabase.auth.signOut();
  }

  const redirectUrl = new URL("/login", request.url);
  redirectUrl.searchParams.set("signedOut", "1");

  const response = NextResponse.redirect(redirectUrl, { status: 303 });
  clearDemoCookie(response);

  return response;
}
