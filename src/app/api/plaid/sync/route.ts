import {
  createPlaidRouteWriteClient,
  plaidRouteError,
  requirePlaidRouteUser
} from "@/lib/plaid/route-helpers";
import { getPlaidRuntimeEnvironment } from "@/lib/plaid/config";
import {
  listPlaidConnections,
  summarizeSyncRun,
  syncPlaidConnections,
  syncPlaidItem
} from "@/lib/plaid/service";
import { jsonNoStore, requireSameOriginRequest } from "@/lib/security/request";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readSyncRequest(request: NextRequest) {
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

  const context = await requirePlaidRouteUser();
  if ("response" in context) return context.response;

  const parsed = await readSyncRequest(request);
  if ("error" in parsed) {
    return jsonNoStore({ error: parsed.error }, { status: 400 });
  }

  try {
    const writeClient = createPlaidRouteWriteClient();
    const sync = parsed.itemId
      ? summarizeSyncRun([await syncPlaidItem({
        client: writeClient,
        itemId: parsed.itemId,
        userId: context.user.id
      })])
      : await syncPlaidConnections(writeClient, context.user.id);
    const connections = await listPlaidConnections(writeClient, context.user.id);
    const environment = getPlaidRuntimeEnvironment();

    return jsonNoStore({ connections, environment, sync });
  } catch (error) {
    return plaidRouteError(
      "plaid_sync_failed",
      error,
      "Unable to sync Plaid data."
    );
  }
}
