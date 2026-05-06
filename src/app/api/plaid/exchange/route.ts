import { plaidRouteError, requirePlaidRouteUser } from "@/lib/plaid/route-helpers";
import { exchangePlaidPublicToken, type PlaidInstitutionInput } from "@/lib/plaid/service";
import { NextResponse, type NextRequest } from "next/server";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readExchangeRequest(request: NextRequest) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return { error: "Invalid JSON body." } as const;
  }

  if (!isRecord(body)) {
    return { error: "Invalid request body." } as const;
  }

  const publicToken = asOptionalString(body.publicToken);
  if (!publicToken) {
    return { error: "Missing Plaid public token." } as const;
  }

  const institutionBody = isRecord(body.institution) ? body.institution : null;
  const institution: PlaidInstitutionInput | undefined = institutionBody
    ? {
      institutionId: asOptionalString(institutionBody.institutionId),
      name: asOptionalString(institutionBody.name)
    }
    : undefined;

  return { institution, publicToken } as const;
}

export async function POST(request: NextRequest) {
  const context = await requirePlaidRouteUser();
  if ("response" in context) return context.response;

  const parsed = await readExchangeRequest(request);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const connection = await exchangePlaidPublicToken({
      client: context.supabase,
      institution: parsed.institution,
      publicToken: parsed.publicToken,
      userId: context.user.id
    });

    return NextResponse.json({ connection });
  } catch (error) {
    return plaidRouteError(
      "plaid_public_token_exchange_failed",
      error,
      "Unable to finish the Plaid connection."
    );
  }
}
