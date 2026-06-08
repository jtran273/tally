import {
  normalizeTransactionFilters,
  parseTransactionFilters,
  toTransactionListFilters,
  type TransactionFilterState,
  type TransactionSearchParams
} from "@/components/finance/transactions/filters";
import {
  listCategories,
  listTransactionAccounts,
  listTransactions
} from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";
import {
  buildTransactionsCsv,
  listTransactionReimbursementSummaries
} from "@/lib/export/transactions";
import { logSafeError } from "@/lib/security/logging";
import { jsonNoStore, requireSameOriginReadRequest } from "@/lib/security/request";
import { type NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function searchParamsToRecord(searchParams: URLSearchParams): TransactionSearchParams {
  const params: TransactionSearchParams = {};

  searchParams.forEach((value, key) => {
    const existing = params[key];
    if (existing === undefined) {
      params[key] = value;
    } else if (Array.isArray(existing)) {
      params[key] = [...existing, value];
    } else {
      params[key] = [existing, value];
    }
  });

  return params;
}

function exportFilename(filters: TransactionFilterState) {
  const parts = ["transactions"];

  if (filters.effectiveFromDate || filters.effectiveToDate) {
    parts.push(`${filters.effectiveFromDate ?? "start"}-to-${filters.effectiveToDate ?? "end"}`);
  }
  if (filters.intent !== "all") {
    parts.push(filters.intent);
  }
  if (filters.direction !== "all") {
    parts.push(filters.direction);
  }
  if (filters.reviewStatus !== "all") {
    parts.push(`review-${filters.reviewStatus}`);
  }
  if (filters.reviewReason !== "all") {
    parts.push(`reason-${filters.reviewReason}`);
  }

  return `${parts.join("-")}.csv`;
}

export async function GET(request: NextRequest) {
  const originError = requireSameOriginReadRequest(request);
  if (originError) return originError;

  const context = await getFinanceServerContext();

  if (!context.isConfigured) {
    return jsonNoStore({ error: "Authentication is not configured." }, { status: 503 });
  }

  if (!context.client || !context.userId) {
    return jsonNoStore({ error: "Authentication required." }, { status: 401 });
  }

  const parsedFilters = parseTransactionFilters(searchParamsToRecord(request.nextUrl.searchParams));

  try {
    const [accounts, categories] = await Promise.all([
      listTransactionAccounts(context.client, context.userId),
      listCategories(context.client, context.userId)
    ]);
    const filters = normalizeTransactionFilters(parsedFilters, accounts, categories);
    const transactions = await listTransactions(context.client, context.userId, {
      ...toTransactionListFilters(filters),
      includeDisconnectedAccounts: true
    });
    const reimbursements = await listTransactionReimbursementSummaries(
      context.client,
      context.userId,
      transactions.map((transaction) => transaction.id)
    );
    const csv = buildTransactionsCsv(transactions, reimbursements);

    return new NextResponse(csv, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="${exportFilename(filters)}"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (exportError) {
    logSafeError("transactions_export_failed", exportError);
    return jsonNoStore({ error: "Unable to export transactions." }, { status: 500 });
  }
}
