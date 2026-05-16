import {
  createPlaidRouteWriteClient,
  plaidRouteError,
  requirePlaidRouteUser
} from "@/lib/plaid/route-helpers";
import { isDemoMode } from "@/lib/demo/auth";
import { syncOpportunisticPlaidConnections } from "@/lib/plaid/service";
import { jsonNoStore, requireSameOriginRequest } from "@/lib/security/request";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  if (await isDemoMode()) {
    return jsonNoStore({ opportunisticSync: { reason: "no_items" } });
  }

  const context = await requirePlaidRouteUser();
  if ("response" in context) return context.response;

  try {
    const writeClient = createPlaidRouteWriteClient();
    const opportunisticSync = await syncOpportunisticPlaidConnections(writeClient, context.user.id);

    return jsonNoStore({ opportunisticSync });
  } catch (error) {
    return plaidRouteError(
      "opportunistic_plaid_sync_failed",
      error,
      "Unable to check for new Plaid data."
    );
  }
}
