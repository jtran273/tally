import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "../supabase/server";
import { getPlaidErrorStatus, logPlaidError } from "./errors";

export async function requirePlaidRouteUser() {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return {
      response: NextResponse.json({ error: "Authentication is not configured." }, { status: 503 })
    } as const;
  }

  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      response: NextResponse.json({ error: "Authentication required." }, { status: 401 })
    } as const;
  }

  return { supabase, user } as const;
}

export function plaidRouteError(context: string, error: unknown, userMessage: string) {
  logPlaidError(context, error);

  return NextResponse.json(
    { error: userMessage },
    { status: getPlaidErrorStatus(error) }
  );
}
