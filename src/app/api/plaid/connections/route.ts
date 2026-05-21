import { isDemoMode } from "@/lib/demo/auth";
import { listDemoPlaidConnections } from "@/lib/demo/finance-client";
import {
  createPlaidRouteWriteClient,
  plaidRouteError,
  requirePlaidRouteUser
} from "@/lib/plaid/route-helpers";
import { getPlaidRuntimeEnvironment } from "@/lib/plaid/config";
import { listPlaidConnections, setPlaidAutoSyncForUser } from "@/lib/plaid/service";
import { jsonNoStore, requireSameOriginRequest } from "@/lib/security/request";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  if (await isDemoMode()) {
    return jsonNoStore({
      connections: listDemoPlaidConnections(),
      environment: getPlaidRuntimeEnvironment()
    });
  }

  const context = await requirePlaidRouteUser();
  if ("response" in context) return context.response;

  try {
    const connections = await listPlaidConnections(context.supabase, context.user.id);
    const environment = getPlaidRuntimeEnvironment();

    return jsonNoStore({ connections, environment });
  } catch (error) {
    return plaidRouteError(
      "plaid_connections_list_failed",
      error,
      "Unable to load Plaid connections."
    );
  }
}

export async function PATCH(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  if (await isDemoMode()) {
    return jsonNoStore({ error: "Demo mode keeps sample bank connections read-only." }, { status: 403 });
  }

  const context = await requirePlaidRouteUser();
  if ("response" in context) return context.response;

  const body = await request.json().catch(() => null);
  const autoSyncEnabled = body && typeof body === "object"
    ? (body as { autoSyncEnabled?: unknown }).autoSyncEnabled
    : undefined;

  if (typeof autoSyncEnabled !== "boolean") {
    return jsonNoStore({ error: "autoSyncEnabled must be a boolean." }, { status: 400 });
  }

  try {
    const writeClient = createPlaidRouteWriteClient();
    await setPlaidAutoSyncForUser(writeClient, context.user.id, autoSyncEnabled);
    const connections = await listPlaidConnections(writeClient, context.user.id);
    const environment = getPlaidRuntimeEnvironment();
    return jsonNoStore({ autoSyncEnabled, connections, environment });
  } catch (error) {
    return plaidRouteError(
      "plaid_auto_sync_update_failed",
      error,
      "Unable to update auto-sync setting."
    );
  }
}
