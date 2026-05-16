import { createPlaidLinkToken } from "@/lib/plaid/service";
import { isDemoMode } from "@/lib/demo/auth";
import {
  createPlaidRouteWriteClient,
  plaidRouteError,
  requirePlaidRouteUser
} from "@/lib/plaid/route-helpers";
import { jsonNoStore, requireSameOriginRequest } from "@/lib/security/request";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readLinkTokenRequest(request: NextRequest) {
  const text = await request.text();
  if (!text.trim()) return { itemId: undefined };

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: "Invalid JSON body." } as const;
  }

  if (!isRecord(body)) return { error: "Invalid request body." } as const;

  const connectionId = body.connectionId;
  if (connectionId === undefined || connectionId === null || connectionId === "") {
    return { itemId: undefined };
  }

  if (typeof connectionId !== "string") {
    return { error: "Invalid Plaid connection id." } as const;
  }

  return { itemId: connectionId.trim() || undefined };
}

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  if (await isDemoMode()) {
    return jsonNoStore({ error: "Demo mode does not connect banks." }, { status: 403 });
  }

  const context = await requirePlaidRouteUser();
  if ("response" in context) return context.response;

  const parsed = await readLinkTokenRequest(request);
  if ("error" in parsed) {
    return jsonNoStore({ error: parsed.error }, { status: 400 });
  }

  try {
    const writeClient = parsed.itemId ? createPlaidRouteWriteClient() : undefined;
    const token = await createPlaidLinkToken({
      client: writeClient,
      itemId: parsed.itemId,
      userEmail: context.user.email ?? null,
      userId: context.user.id
    });

    return jsonNoStore({
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
