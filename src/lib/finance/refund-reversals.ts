export const DEFAULT_REVERSAL_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;
const MERCHANT_NOISE_WORDS = new Set([
  "auth",
  "authorization",
  "cancel",
  "canceled",
  "cancelled",
  "credit",
  "pending",
  "refund",
  "refunded",
  "return",
  "reversal",
  "reverse",
  "temporary",
  "void"
]);
const REVERSAL_SIGNAL_PATTERN = /\b(auth(?:orization)?|cancel(?:ed|led)?|credit|refund(?:ed)?|return|reversal|reverse|temporary|void)\b/i;
const PEER_TO_PEER_PATTERN = /\b(venmo|zelle|cash\s*app|cashapp|apple\s+cash|paypal)\b/i;

export interface RefundReversalCandidate {
  account_id?: string | null;
  accountId?: string | null;
  amount: number;
  date: string;
  id: string;
  intent?: string | null;
  merchant?: string | null;
  merchant_name?: string | null;
  merchantName?: string | null;
  name?: string | null;
  plaid_name?: string | null;
  plaidName?: string | null;
}

export interface RefundReversalMatch<T extends RefundReversalCandidate> {
  credit: T;
  debit: T;
}

function roundCents(value: number) {
  return Math.round(value * 100);
}

function dayNumber(value: string) {
  const time = new Date(`${value}T12:00:00.000Z`).getTime();
  return Number.isFinite(time) ? Math.floor(time / DAY_MS) : null;
}

function accountId(candidate: RefundReversalCandidate) {
  return candidate.accountId ?? candidate.account_id ?? null;
}

function merchantName(candidate: RefundReversalCandidate) {
  return candidate.merchant ?? candidate.merchantName ?? candidate.merchant_name ?? "";
}

function statementText(candidate: RefundReversalCandidate) {
  return [
    merchantName(candidate),
    candidate.plaidName ?? candidate.plaid_name ?? candidate.name ?? ""
  ].filter(Boolean).join(" ");
}

function hasReversalSignal(candidate: RefundReversalCandidate) {
  return REVERSAL_SIGNAL_PATTERN.test(statementText(candidate));
}

function hasPeerToPeerMerchant(candidate: RefundReversalCandidate) {
  return PEER_TO_PEER_PATTERN.test(statementText(candidate));
}

export function normalizeRefundReversalMerchant(value: string | null | undefined) {
  return (value ?? "")
    .toLowerCase()
    .replace(/\*[^a-z]+/g, " ")
    .replace(/[^a-z]+/g, " ")
    .split(/\s+/)
    .filter((word) => word && !MERCHANT_NOISE_WORDS.has(word))
    .join(" ");
}

function merchantLooksMatched(left: string, right: string, hasReversalEvidence: boolean) {
  if (!left || !right) return false;
  if (left === right) return true;
  if (!hasReversalEvidence) return false;
  const [leftLead] = left.split(" ");
  const [rightLead] = right.split(" ");
  return Boolean(leftLead && rightLead && leftLead.length >= 4 && leftLead === rightLead);
}

function canMatchRefundReversal(left: RefundReversalCandidate, right: RefundReversalCandidate, windowDays: number) {
  if (left.id === right.id) return false;
  if (left.intent === "transfer" || right.intent === "transfer") return false;
  if (roundCents(left.amount) + roundCents(right.amount) !== 0) return false;
  const hasReversalEvidence = hasReversalSignal(left) || hasReversalSignal(right);
  if (!hasReversalEvidence && (hasPeerToPeerMerchant(left) || hasPeerToPeerMerchant(right))) return false;

  const leftAccountId = accountId(left);
  const rightAccountId = accountId(right);
  if (leftAccountId && rightAccountId && leftAccountId !== rightAccountId) return false;

  const leftMerchant = normalizeRefundReversalMerchant(merchantName(left));
  const rightMerchant = normalizeRefundReversalMerchant(merchantName(right));
  if (!merchantLooksMatched(leftMerchant, rightMerchant, hasReversalEvidence)) return false;

  const leftDay = dayNumber(left.date);
  const rightDay = dayNumber(right.date);
  if (leftDay === null || rightDay === null) return false;

  return Math.abs(leftDay - rightDay) <= windowDays;
}

export function getMatchedRefundReversalTransactionIds<T extends RefundReversalCandidate>(
  transactions: readonly T[],
  options: { windowDays?: number } = {}
) {
  const windowDays = options.windowDays ?? DEFAULT_REVERSAL_WINDOW_DAYS;
  const matchedIds = new Set<string>();
  const credits = transactions
    .filter((transaction) => transaction.amount > 0)
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));

  for (const debit of transactions
    .filter((transaction) => transaction.amount < 0)
    .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id))) {
    if (matchedIds.has(debit.id)) continue;

    const credit = credits.find((candidate) =>
      !matchedIds.has(candidate.id) &&
      canMatchRefundReversal(debit, candidate, windowDays)
    );
    if (!credit) continue;

    matchedIds.add(debit.id);
    matchedIds.add(credit.id);
  }

  return matchedIds;
}

export function findRefundReversalMatch<T extends RefundReversalCandidate>(
  transactions: readonly T[],
  target: T,
  options: { windowDays?: number } = {}
): RefundReversalMatch<T> | null {
  const windowDays = options.windowDays ?? DEFAULT_REVERSAL_WINDOW_DAYS;
  const targetDay = dayNumber(target.date);
  const candidates = transactions
    .filter((transaction) => transaction.id !== target.id)
    .sort((left, right) =>
      Math.abs((targetDay ?? 0) - (dayNumber(left.date) ?? 0)) -
        Math.abs((targetDay ?? 0) - (dayNumber(right.date) ?? 0)) ||
      left.date.localeCompare(right.date) ||
      left.id.localeCompare(right.id)
    );
  const match = candidates.find((candidate) => canMatchRefundReversal(target, candidate, windowDays));
  if (!match) return null;

  return target.amount > 0
    ? { credit: target, debit: match }
    : { credit: match, debit: target };
}

export function excludeMatchedRefundReversalTransactions<T extends RefundReversalCandidate>(
  transactions: readonly T[],
  options: { windowDays?: number } = {}
) {
  const matchedIds = getMatchedRefundReversalTransactionIds(transactions, options);
  if (matchedIds.size === 0) return [...transactions];
  return transactions.filter((transaction) => !matchedIds.has(transaction.id));
}

export function isReportableInflowTransaction(transaction: RefundReversalCandidate) {
  return transaction.amount > 0 && transaction.intent !== "transfer";
}

export function filterReportableInflowTransactions<T extends RefundReversalCandidate>(
  transactions: readonly T[],
  options: { windowDays?: number } = {}
) {
  return excludeMatchedRefundReversalTransactions(transactions, options)
    .filter(isReportableInflowTransaction);
}
