import {
  normalizeTransactionFilters,
  parseTransactionFilters,
  toTransactionListFilters,
  type TransactionFilterState,
  type TransactionSearchParams
} from "@/components/finance/transactions/filters";
import {
  listAccounts,
  listCategories,
  listTransactions,
  type FinanceSupabaseClient
} from "@/lib/db";
import {
  buildTransactionsCsv,
  listTransactionReimbursementSummaries
} from "@/lib/export/transactions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
  if (filters.reviewStatus !== "all") {
    parts.push(`review-${filters.reviewStatus}`);
  }

  return `${parts.join("-")}.csv`;
}

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();

  if (!supabase) {
    return NextResponse.json({ error: "Authentication is not configured." }, { status: 503 });
  }

  const {
    data: { user },
    error
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const financeClient = supabase as unknown as FinanceSupabaseClient;
  const parsedFilters = parseTransactionFilters(searchParamsToRecord(request.nextUrl.searchParams));

  try {
    const [accounts, categories] = await Promise.all([
      listAccounts(financeClient, user.id),
      listCategories(financeClient, user.id)
    ]);
    const filters = normalizeTransactionFilters(parsedFilters, accounts, categories);
    const transactions = await listTransactions(financeClient, user.id, toTransactionListFilters(filters));
    const reimbursements = await listTransactionReimbursementSummaries(
      financeClient,
      user.id,
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
    console.error("transactions_export_failed", exportError);
    return NextResponse.json({ error: "Unable to export transactions." }, { status: 500 });
  }
}
