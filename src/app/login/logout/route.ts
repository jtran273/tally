import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();

  if (supabase) {
    await supabase.auth.signOut();
  }

  const redirectUrl = new URL("/login", request.url);
  redirectUrl.searchParams.set("signedOut", "1");

  return NextResponse.redirect(redirectUrl, { status: 303 });
}
