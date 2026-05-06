import { createPlaidLinkToken } from "@/lib/plaid/service";
import { plaidRouteError, requirePlaidRouteUser } from "@/lib/plaid/route-helpers";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  const context = await requirePlaidRouteUser();
  if ("response" in context) return context.response;

  try {
    const token = await createPlaidLinkToken({
      userEmail: context.user.email ?? null,
      userId: context.user.id
    });

    return NextResponse.json({
      expiration: token.expiration,
      linkToken: token.linkToken
    });
  } catch (error) {
    return plaidRouteError(
      "plaid_link_token_create_failed",
      error,
      "Unable to create a Plaid Link token."
    );
  }
}
