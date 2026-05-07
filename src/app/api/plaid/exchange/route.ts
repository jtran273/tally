import {
  createPlaidRouteWriteClient,
  plaidRouteError,
  requirePlaidRouteUser
} from "@/lib/plaid/route-helpers";
import {
  exchangePlaidPublicToken,
  listPlaidConnections,
  syncPlaidItem,
  type PlaidSyncItemSummary,
  type PlaidInstitutionInput
} from "@/lib/plaid/service";
import { logPlaidError } from "@/lib/plaid/errors";
import { jsonNoStore, requireSameOriginRequest } from "@/lib/security/request";
import { type NextRequest } from "next/server";

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
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  const context = await requirePlaidRouteUser();
  if ("response" in context) return context.response;

  const parsed = await readExchangeRequest(request);
  if ("error" in parsed) {
    return jsonNoStore({ error: parsed.error }, { status: 400 });
  }

  try {
    const writeClient = createPlaidRouteWriteClient();
    const connection = await exchangePlaidPublicToken({
      client: writeClient,
      institution: parsed.institution,
      publicToken: parsed.publicToken,
      userId: context.user.id
    });
    let syncedConnection = connection;
    let sync: PlaidSyncItemSummary | null = null;
    let syncError: string | null = null;

    try {
      sync = await syncPlaidItem({
        client: writeClient,
        itemId: connection.id,
        source: "initial",
        userId: context.user.id
      });
      const connections = await listPlaidConnections(writeClient, context.user.id);
      syncedConnection = connections.find((item) => item.id === connection.id) ?? connection;
    } catch (error) {
      logPlaidError("plaid_initial_sync_failed", error);
      syncError = "Initial Plaid sync did not complete. You can retry from settings.";
      const connections = await listPlaidConnections(writeClient, context.user.id);
      syncedConnection = connections.find((item) => item.id === connection.id) ?? connection;
    }

    return jsonNoStore({ connection: syncedConnection, sync, syncError });
  } catch (error) {
    return plaidRouteError(
      "plaid_public_token_exchange_failed",
      error,
      "Unable to finish the Plaid connection."
    );
  }
}
