import { plaidRouteError, requirePlaidRouteUser } from "@/lib/plaid/route-helpers";
import { listPlaidConnections } from "@/lib/plaid/service";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const context = await requirePlaidRouteUser();
  if ("response" in context) return context.response;

  try {
    const connections = await listPlaidConnections(context.supabase, context.user.id);

    return NextResponse.json({ connections });
  } catch (error) {
    return plaidRouteError(
      "plaid_connections_list_failed",
      error,
      "Unable to load Plaid connections."
    );
  }
}
