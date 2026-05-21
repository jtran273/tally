import { type NextRequest } from "next/server";
import { listReviewItems, listTransactions } from "@/lib/db";
import {
  buildOpenClawQueryResponse,
  buildOpenClawRecentTransactionsResponse,
  buildOpenClawReimbursementsResponse,
  buildOpenClawReviewItemsResponse,
  buildOpenClawSafeToSpendResponse,
  type OpenClawFinanceQueryIntent,
  OpenClawFinanceReadBadRequestError,
  parseOpenClawLimit,
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

const QUERY_INTENTS = new Set<OpenClawFinanceQueryIntent>([
  "recent_transactions",
  "review_items",
  "reimbursements",
  "safe_to_spend"
]);

async function readJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    throw new OpenClawFinanceReadBadRequestError("Request body must be valid JSON.");
  }
}

function parseIntent(value: unknown): OpenClawFinanceQueryIntent {
  if (typeof value !== "string" || !QUERY_INTENTS.has(value as OpenClawFinanceQueryIntent)) {
    throw new OpenClawFinanceReadBadRequestError("intent must be one of recent_transactions, review_items, reimbursements, or safe_to_spend.");
  }
  return value as OpenClawFinanceQueryIntent;
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export async function POST(request: NextRequest) {
  const unauthorized = requireOpenClawAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await readJson(request);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new OpenClawFinanceReadBadRequestError("Request body must be a JSON object.");
    }
    const input = body as Record<string, unknown>;
    const intent = parseIntent(input.intent);
    const limit = parseOpenClawLimit(input.limit as string | number | null | undefined);
    const amount = parseSafeToSpendAmount(input.amount as string | number | null | undefined);
    const since = resolveOpenClawSince(typeof input.since === "string" ? input.since : null);
    const { client, userId } = createOpenClawServiceContext();

    if (intent === "recent_transactions") {
      const transactions = await listTransactions(client, userId, { limit });
      const result = buildOpenClawRecentTransactionsResponse(transactions, { limit });
      return jsonNoStore(buildOpenClawQueryResponse(intent, result, result.generatedAt));
    }

    if (intent === "review_items") {
      const reviewItems = await listReviewItems(client, userId, "open");
      const result = buildOpenClawReviewItemsResponse(reviewItems, { limit });
      return jsonNoStore(buildOpenClawQueryResponse(intent, result, result.generatedAt));
    }

    if (intent === "reimbursements") {
      const now = new Date();
      const transactions = await listTransactions(client, userId, {
        fromDate: isoDate(addDays(now, -120)),
        limit: 250,
        toDate: isoDate(now)
      });
      const result = buildOpenClawReimbursementsResponse(transactions, { limit });
      return jsonNoStore(buildOpenClawQueryResponse(intent, result, result.generatedAt));
    }

    const signals = await loadOpenClawSignals(client, userId, { since });
    const result = buildOpenClawSafeToSpendResponse(signals, { amount });
    return jsonNoStore(buildOpenClawQueryResponse(intent, result, result.generatedAt));
  } catch (error) {
    if (error instanceof OpenClawFinanceReadBadRequestError || error instanceof OpenClawSignalsBadRequestError) {
      return jsonNoStore({ error: error.message }, { status: 400 });
    }
    if (error instanceof OpenClawRouteConfigurationError) {
      return jsonNoStore({ error: "OpenClaw integration is not configured." }, { status: 503 });
    }

    logSafeError("openclaw_query_failed", error);
    return jsonNoStore({ error: "Unable to answer OpenClaw query." }, { status: 500 });
  }
}
