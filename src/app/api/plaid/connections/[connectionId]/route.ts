import {
  createPlaidRouteWriteClient,
  plaidRouteError,
  requirePlaidRouteUser
} from "@/lib/plaid/route-helpers";
import { isDemoMode } from "@/lib/demo/auth";
import { listPlaidConnections, revokePlaidConnection } from "@/lib/plaid/service";
import { jsonNoStore, requireSameOriginRequest } from "@/lib/security/request";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{
    connectionId: string;
  }>;
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  if (await isDemoMode()) {
    return jsonNoStore({ error: "Demo mode keeps sample bank connections read-only." }, { status: 403 });
  }

  const routeContext = await requirePlaidRouteUser();
  if ("response" in routeContext) return routeContext.response;

  const { connectionId } = await context.params;
  if (!connectionId) {
    return jsonNoStore({ error: "Missing Plaid connection id." }, { status: 400 });
  }

  try {
    const writeClient = createPlaidRouteWriteClient();
    const connection = await revokePlaidConnection({
      client: writeClient,
      itemId: connectionId,
      userId: routeContext.user.id
    });
    const connections = await listPlaidConnections(writeClient, routeContext.user.id);

    return jsonNoStore({ connection, connections });
  } catch (error) {
    return plaidRouteError(
      "plaid_connection_revoke_failed",
      error,
      "Unable to disconnect Plaid institution."
    );
  }
}
