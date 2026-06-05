import { type NextRequest } from "next/server";
import { buildOpenClawPlaidRefreshResponse } from "@/lib/openclaw/plaid-refresh";
import {
  getConfiguredOpenClawUserId,
  OpenClawRouteConfigurationError,
  requireOpenClawPlaidRefreshAuth
} from "@/lib/openclaw/route-helpers";
import { PlaidRouteConfigurationError } from "@/lib/plaid/errors";
import { createPlaidRouteWriteClient } from "@/lib/plaid/route-helpers";
import { syncOpportunisticPlaidConnections } from "@/lib/plaid/service";
import { logSafeError } from "@/lib/security/logging";
import { jsonNoStore } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const unauthorized = requireOpenClawPlaidRefreshAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const userId = getConfiguredOpenClawUserId();
    const refresh = await syncOpportunisticPlaidConnections(createPlaidRouteWriteClient(), userId);

    return jsonNoStore(buildOpenClawPlaidRefreshResponse(refresh));
  } catch (error) {
    if (error instanceof OpenClawRouteConfigurationError || error instanceof PlaidRouteConfigurationError) {
      return jsonNoStore({ error: "OpenClaw integration is not configured." }, { status: 503 });
    }

    logSafeError("openclaw_plaid_refresh_failed", error);
    return jsonNoStore({ error: "Unable to refresh Tally Plaid data." }, { status: 500 });
  }
}
