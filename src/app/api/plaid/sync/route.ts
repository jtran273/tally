import {
  createPlaidRouteWriteClient,
  plaidRouteError,
  requirePlaidRouteUser
} from "@/lib/plaid/route-helpers";
import { getPlaidRuntimeEnvironment } from "@/lib/plaid/config";
import { listPlaidConnections, syncPlaidConnections } from "@/lib/plaid/service";
import { jsonNoStore, requireSameOriginRequest } from "@/lib/security/request";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  const context = await requirePlaidRouteUser();
  if ("response" in context) return context.response;

  try {
    const writeClient = createPlaidRouteWriteClient();
    const sync = await syncPlaidConnections(writeClient, context.user.id);
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
