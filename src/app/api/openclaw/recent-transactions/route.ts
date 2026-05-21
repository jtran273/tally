import { type NextRequest } from "next/server";
import { listTransactions } from "@/lib/db";
import {
  buildOpenClawRecentTransactionsResponse,
  OpenClawFinanceReadBadRequestError,
  parseOpenClawLimit
} from "@/lib/openclaw/finance-read-api";
import {
  createOpenClawServiceContext,
  OpenClawRouteConfigurationError,
  requireOpenClawAuth
} from "@/lib/openclaw/route-helpers";
import { logSafeError } from "@/lib/security/logging";
import { jsonNoStore } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const unauthorized = requireOpenClawAuth(request);
  if (unauthorized) return unauthorized;

  let limit: number;
  try {
    limit = parseOpenClawLimit(request.nextUrl.searchParams.get("limit"));
  } catch (error) {
    if (error instanceof OpenClawFinanceReadBadRequestError) {
      return jsonNoStore({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  try {
    const { client, userId } = createOpenClawServiceContext();
    const transactions = await listTransactions(client, userId, { limit });
    return jsonNoStore(buildOpenClawRecentTransactionsResponse(transactions, { limit }));
  } catch (error) {
    if (error instanceof OpenClawRouteConfigurationError) {
      return jsonNoStore({ error: "OpenClaw integration is not configured." }, { status: 503 });
    }

    logSafeError("openclaw_recent_transactions_failed", error);
    return jsonNoStore({ error: "Unable to load OpenClaw recent transactions." }, { status: 500 });
  }
}
