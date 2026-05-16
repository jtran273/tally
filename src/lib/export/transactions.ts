import type {
  FinanceSupabaseClient,
  ReimbursementRecordRow,
  TransactionRecord
} from "@/lib/db";

type CsvValue = boolean | number | string | null | undefined;

export interface TransactionReimbursementSummary {
  count: number;
  counterparties: string;
  dueDates: string;
  expectedAmount: number;
  notes: string;
  receivedAmount: number;
  receivedDates: string;
  statuses: string;
}

interface TransactionCsvColumn {
  header: string;
  value: (
    transaction: TransactionRecord,
    reimbursement?: TransactionReimbursementSummary
  ) => CsvValue;
}

const DANGEROUS_CSV_LEADING_CONTROL_PATTERN = /^[\t\r\n]/;
const DANGEROUS_CSV_FORMULA_PATTERN = /^[ \t\r\n]*[=+\-@]/;

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function escapeCsvCell(value: CsvValue) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return formatNumber(value);

  const text = String(value);
  const safeText =
    DANGEROUS_CSV_LEADING_CONTROL_PATTERN.test(text) || DANGEROUS_CSV_FORMULA_PATTERN.test(text)
      ? `'${text}`
      : text;
  const needsQuoting = /[",\r\n]/.test(safeText) || safeText.trim() !== safeText || text.trim() !== text;
  const escaped = safeText.replaceAll("\"", "\"\"");

  return needsQuoting ? `"${escaped}"` : escaped;
}

function accountLabel(transaction: TransactionRecord) {
  return [
    transaction.accountName,
    transaction.accountMask ? `-${transaction.accountMask}` : null
  ].filter(Boolean).join(" ");
}

function categoryName(category: string) {
  const parts = category.split("/").map((part) => part.trim()).filter(Boolean);
  return parts.at(-1) ?? category;
}

function reviewStatuses(transaction: TransactionRecord) {
  return unique(transaction.reviewItems.map((review) => review.status)).join("; ");
}

function reviewReasons(transaction: TransactionRecord) {
  return unique(transaction.reviewItems.map((review) => review.reason)).join("; ");
}

function reviewNotes(transaction: TransactionRecord) {
  return unique(
    transaction.reviewItems.flatMap((review) => [
      review.explanation,
      review.resolutionNote
    ])
  ).join(" | ");
}

function summarizeReimbursements(rows: ReimbursementRecordRow[]): TransactionReimbursementSummary {
  return {
    count: rows.length,
    counterparties: unique(rows.map((row) => row.counterparty)).join("; "),
    dueDates: unique(rows.map((row) => row.due_date)).join("; "),
    expectedAmount: rows.reduce((sum, row) => sum + row.expected_amount, 0),
    notes: unique(rows.map((row) => row.notes)).join(" | "),
    receivedAmount: rows.reduce((sum, row) => sum + row.received_amount, 0),
    receivedDates: unique(rows.map((row) => row.received_at)).join("; "),
    statuses: unique(rows.map((row) => row.status)).join("; ")
  };
}

function groupReimbursements(rows: ReimbursementRecordRow[]) {
  const grouped = new Map<string, ReimbursementRecordRow[]>();

  rows.forEach((row) => {
    grouped.set(row.enriched_transaction_id, [
      ...(grouped.get(row.enriched_transaction_id) ?? []),
      row
    ]);
  });

  return new Map(
    [...grouped.entries()].map(([transactionId, reimbursementRows]) => [
      transactionId,
      summarizeReimbursements(reimbursementRows)
    ])
  );
}

export async function listTransactionReimbursementSummaries(
  client: FinanceSupabaseClient,
  userId: string,
  transactionIds: string[]
): Promise<Map<string, TransactionReimbursementSummary>> {
  const uniqueTransactionIds = unique(transactionIds);
  if (uniqueTransactionIds.length === 0) return new Map();

  const result = await client
    .from("reimbursement_records")
    .select("*")
    .eq("user_id", userId)
    .in("enriched_transaction_id", uniqueTransactionIds)
    .order("created_at", { ascending: true });

  if (result.error) {
    throw new Error(`Load reimbursement records for export: ${result.error.message}`);
  }

  return groupReimbursements(result.data ?? []);
}

const transactionCsvColumns: TransactionCsvColumn[] = [
  { header: "date", value: (transaction) => transaction.date },
  { header: "merchant", value: (transaction) => transaction.merchant },
  { header: "amount", value: (transaction) => transaction.amount },
  { header: "account", value: accountLabel },
  { header: "institution", value: (transaction) => transaction.institutionName },
  { header: "raw_category", value: (transaction) => transaction.plaidCategory },
  { header: "user_category", value: (transaction) => transaction.category },
  { header: "category_name", value: (transaction) => categoryName(transaction.category) },
  { header: "intent", value: (transaction) => transaction.intent },
  { header: "notes", value: (transaction) => transaction.note },
  { header: "transaction_status", value: (transaction) => transaction.status },
  { header: "review_status", value: reviewStatuses },
  { header: "review_reason", value: reviewReasons },
  { header: "review_notes", value: reviewNotes },
  { header: "reviewed_at", value: (transaction) => transaction.reviewedAt },
  { header: "reimbursement_status", value: (_transaction, reimbursement) => reimbursement?.statuses },
  { header: "reimbursement_counterparty", value: (_transaction, reimbursement) => reimbursement?.counterparties },
  { header: "reimbursement_expected_amount", value: (_transaction, reimbursement) => reimbursement?.expectedAmount },
  { header: "reimbursement_received_amount", value: (_transaction, reimbursement) => reimbursement?.receivedAmount },
  { header: "reimbursement_due_date", value: (_transaction, reimbursement) => reimbursement?.dueDates },
  { header: "reimbursement_received_at", value: (_transaction, reimbursement) => reimbursement?.receivedDates },
  { header: "reimbursement_notes", value: (_transaction, reimbursement) => reimbursement?.notes },
  { header: "raw_transaction_id", value: (transaction) => transaction.rawTransactionId },
  { header: "transaction_id", value: (transaction) => transaction.id },
  { header: "account_id", value: (transaction) => transaction.accountId },
  { header: "plaid_merchant", value: (transaction) => transaction.plaidMerchant },
  { header: "plaid_name", value: (transaction) => transaction.plaidName },
  { header: "recurring", value: (transaction) => transaction.recurring }
];

export function buildTransactionsCsv(
  transactions: TransactionRecord[],
  reimbursements = new Map<string, TransactionReimbursementSummary>()
) {
  const rows = [
    transactionCsvColumns.map((column) => column.header),
    ...transactions.map((transaction) =>
      transactionCsvColumns.map((column) => column.value(transaction, reimbursements.get(transaction.id)))
    )
  ];

  return `${rows.map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
}
