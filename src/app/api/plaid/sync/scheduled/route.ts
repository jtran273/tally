import { createPlaidRouteWriteClient, plaidRouteError } from "@/lib/plaid/route-helpers";
import { syncScheduledPlaidConnections } from "@/lib/plaid/service";
import { isAuthorizedBearerToken, jsonNoStore } from "@/lib/security/request";
import { type NextRequest } from "next/server";

export const runtime = "nodejs";

function isAuthorizedScheduledRequest(request: NextRequest) {
  return isAuthorizedBearerToken(request.headers, process.env.CRON_SECRET);
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedScheduledRequest(request)) {
    return jsonNoStore({ error: "Scheduled sync is not authorized." }, { status: 401 });
  }

  try {
    const writeClient = createPlaidRouteWriteClient();
    const sync = await syncScheduledPlaidConnections(writeClient);

    return jsonNoStore({ sync });
  } catch (error) {
    return plaidRouteError(
      "scheduled_plaid_sync_failed",
      error,
      "Unable to run scheduled Plaid sync."
    );
  }
}

export const GET = POST;
