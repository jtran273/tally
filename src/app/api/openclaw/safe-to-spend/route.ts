import { type NextRequest } from "next/server";
import {
  buildOpenClawSafeToSpendResponse,
  OpenClawFinanceReadBadRequestError,
  parseSafeToSpendAmount
} from "@/lib/openclaw/finance-read-api";
import {
  createOpenClawServiceContext,
  OpenClawRouteConfigurationError,
  requireOpenClawAuth
} from "@/lib/openclaw/route-helpers";
import {
  loadOpenClawSignals,
  OpenClawSignalsBadRequestError,
  resolveOpenClawSince
} from "@/lib/openclaw/signals";
import { logSafeError } from "@/lib/security/logging";
import { jsonNoStore } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const unauthorized = requireOpenClawAuth(request);
  if (unauthorized) return unauthorized;

  let amount: number | null;
  let since: string;
  try {
    amount = parseSafeToSpendAmount(request.nextUrl.searchParams.get("amount"));
    since = resolveOpenClawSince(request.nextUrl.searchParams.get("since"));
  } catch (error) {
    if (error instanceof OpenClawFinanceReadBadRequestError || error instanceof OpenClawSignalsBadRequestError) {
      return jsonNoStore({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  try {
    const { client, userId } = createOpenClawServiceContext();
    const signals = await loadOpenClawSignals(client, userId, { since });
    return jsonNoStore(buildOpenClawSafeToSpendResponse(signals, { amount }));
  } catch (error) {
    if (error instanceof OpenClawRouteConfigurationError) {
      return jsonNoStore({ error: "OpenClaw integration is not configured." }, { status: 503 });
    }

    logSafeError("openclaw_safe_to_spend_failed", error);
    return jsonNoStore({ error: "Unable to load OpenClaw safe-to-spend." }, { status: 500 });
  }
}
