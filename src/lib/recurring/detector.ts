import type {
  DetectedRecurringCadence,
  KnownRecurringExpense,
  RecurringAmountEvidence,
  RecurringCadenceEvidence,
  RecurringCandidate,
  RecurringCandidateFlag,
  RecurringCandidateTransaction,
  RecurringDetectionOptions,
  RecurringDetectionTransaction,
  RecurringPriceChangeSignal
} from "./types";

const DAY_MS = 86_400_000;

const DEFAULT_ALLOWED_CADENCES = ["weekly", "biweekly", "monthly", "quarterly", "annual"] as const satisfies readonly DetectedRecurringCadence[];

const DEFAULT_OPTIONS = {
  minOccurrences: 2,
  minimumConfidence: 0.64,
  includePending: false,
  includeIncome: false,
  excludeTransferIntent: true,
  amountToleranceRatio: 0.15,
  amountToleranceAmount: 2,
  priceChangeThresholdRatio: 0.1,
  priceChangeThresholdAmount: 1,
  includeInactiveCandidates: false,
  inactiveCandidateGraceIntervals: 2.5
};

const CADENCE_CONFIG = {
  weekly: {
    expectedDays: 7,
    minDays: 5,
    maxDays: 10,
    toleranceDays: 4
  },
  biweekly: {
    expectedDays: 14,
    minDays: 11,
    maxDays: 18,
    toleranceDays: 5
  },
  monthly: {
    expectedDays: 30.4375,
    minDays: 21,
    maxDays: 45,
    toleranceDays: 12
  },
  quarterly: {
    expectedDays: 91.3125,
    minDays: 75,
    maxDays: 110,
    toleranceDays: 20
  },
  annual: {
    expectedDays: 365.25,
    minDays: 330,
    maxDays: 400,
    toleranceDays: 60
  }
} as const satisfies Record<
  DetectedRecurringCadence,
  {
    expectedDays: number;
    minDays: number;
    maxDays: number;
    toleranceDays: number;
  }
>;

interface ResolvedDetectionOptions {
  existingRecurring: readonly KnownRecurringExpense[];
  allowedCadences: readonly DetectedRecurringCadence[];
  asOfDate?: string;
  minOccurrences: number;
  minimumConfidence: number;
  includePending: boolean;
  includeIncome: boolean;
  excludeTransferIntent: boolean;
  amountToleranceRatio: number;
  amountToleranceAmount: number;
  priceChangeThresholdRatio: number;
  priceChangeThresholdAmount: number;
  includeInactiveCandidates: boolean;
  inactiveCandidateGraceIntervals: number;
}

interface DatedTransaction {
  transaction: RecurringDetectionTransaction;
  day: number;
  absoluteAmount: number;
}

interface CandidateEvaluation {
  candidate: RecurringCandidate;
  score: number;
}

interface AmountEvaluation {
  amount: number;
  score: number;
  evidence: RecurringAmountEvidence;
  priceChange: RecurringPriceChangeSignal | null;
}

export function detectRecurringCandidates(
  transactions: readonly RecurringDetectionTransaction[],
  options: RecurringDetectionOptions = {}
): RecurringCandidate[] {
  const resolvedOptions = resolveOptions(options);
  const grouped = new Map<string, DatedTransaction[]>();

  transactions.forEach((transaction) => {
    const day = dateToDay(transaction.date);
    const normalizedMerchant = normalizeRecurringMerchant(transaction.merchant);

    if (day === null || normalizedMerchant.length === 0 || !shouldConsiderTransaction(transaction, resolvedOptions)) {
      return;
    }

    const key = groupKey(transaction.userId, normalizedMerchant);
    const datedTransaction: DatedTransaction = {
      transaction,
      day,
      absoluteAmount: roundMoney(Math.abs(transaction.amount))
    };
    grouped.set(key, [...(grouped.get(key) ?? []), datedTransaction]);
  });

  return [...grouped.entries()]
    .map(([key, rows]) => evaluateMerchantGroup(key, rows, resolvedOptions))
    .filter((candidate): candidate is CandidateEvaluation => candidate !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.candidate.nextDueDate !== b.candidate.nextDueDate) {
        return a.candidate.nextDueDate.localeCompare(b.candidate.nextDueDate);
      }
      return a.candidate.merchant.localeCompare(b.candidate.merchant);
    })
    .map((evaluation) => evaluation.candidate);
}

export function normalizeRecurringMerchant(merchant: string): string {
  return merchant
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:ach|autopay|bill|card|debit|payment|pos|purchase|recurring|subscription|visa|web|online|inc|llc|ltd|corp|co)\b/g, " ")
    .replace(/\b(?:com|net|org)\b/g, " ")
    .replace(/\b(?:ca|ny|tx|wa|az|fl|il|ma|nj|pa|us|usa)\b/g, " ")
    .replace(/\b\d+[a-z]?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function calculateNextDueDate(
  lastChargeDate: string,
  cadence: DetectedRecurringCadence,
  asOfDate?: string
): string {
  const asOfDay = asOfDate ? dateToDay(asOfDate) : null;
  let nextDueDate = addCadence(lastChargeDate, cadence);

  while (asOfDay !== null) {
    const nextDueDay = dateToDay(nextDueDate);
    if (nextDueDay === null || nextDueDay > asOfDay) break;
    nextDueDate = addCadence(nextDueDate, cadence);
  }

  return nextDueDate;
}

function resolveOptions(options: RecurringDetectionOptions): ResolvedDetectionOptions {
  return {
    existingRecurring: options.existingRecurring ?? [],
    allowedCadences: options.allowedCadences ?? DEFAULT_ALLOWED_CADENCES,
    asOfDate: options.asOfDate,
    minOccurrences: Math.max(2, options.minOccurrences ?? DEFAULT_OPTIONS.minOccurrences),
    minimumConfidence: options.minimumConfidence ?? DEFAULT_OPTIONS.minimumConfidence,
    includePending: options.includePending ?? DEFAULT_OPTIONS.includePending,
    includeIncome: options.includeIncome ?? DEFAULT_OPTIONS.includeIncome,
    excludeTransferIntent: options.excludeTransferIntent ?? DEFAULT_OPTIONS.excludeTransferIntent,
    amountToleranceRatio: options.amountToleranceRatio ?? DEFAULT_OPTIONS.amountToleranceRatio,
    amountToleranceAmount: options.amountToleranceAmount ?? DEFAULT_OPTIONS.amountToleranceAmount,
    priceChangeThresholdRatio: options.priceChangeThresholdRatio ?? DEFAULT_OPTIONS.priceChangeThresholdRatio,
    priceChangeThresholdAmount: options.priceChangeThresholdAmount ?? DEFAULT_OPTIONS.priceChangeThresholdAmount,
    includeInactiveCandidates: options.includeInactiveCandidates ?? DEFAULT_OPTIONS.includeInactiveCandidates,
    inactiveCandidateGraceIntervals: Math.max(
      1,
      options.inactiveCandidateGraceIntervals ?? DEFAULT_OPTIONS.inactiveCandidateGraceIntervals
    )
  };
}

function shouldConsiderTransaction(
  transaction: RecurringDetectionTransaction,
  options: ResolvedDetectionOptions
): boolean {
  if (!options.includePending && transaction.status === "pending") return false;
  if (!options.includeIncome && transaction.amount >= 0) return false;
  if (options.excludeTransferIntent && transaction.intent === "transfer") return false;
  return transaction.amount !== 0;
}

function evaluateMerchantGroup(
  key: string,
  rows: DatedTransaction[],
  options: ResolvedDetectionOptions
): CandidateEvaluation | null {
  if (rows.length < options.minOccurrences) return null;

  const sortedRows = [...rows].sort((a, b) => {
    if (a.day !== b.day) return a.day - b.day;
    return a.transaction.id.localeCompare(b.transaction.id);
  });
  const [userId, normalizedMerchant] = splitGroupKey(key);
  const asOfDate = resolveAsOfDate(options.asOfDate, sortedRows);

  const evaluations = options.allowedCadences
    .map((cadence) => evaluateCadence({
      userId,
      normalizedMerchant,
      rows: sortedRows,
      cadence,
      asOfDate,
      options
    }))
    .filter((evaluation): evaluation is CandidateEvaluation => evaluation !== null);

  if (evaluations.length === 0) return null;

  return evaluations.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return cadenceRank(a.candidate.cadence) - cadenceRank(b.candidate.cadence);
  })[0] ?? null;
}

function evaluateCadence({
  userId,
  normalizedMerchant,
  rows,
  cadence,
  asOfDate,
  options
}: {
  userId: string;
  normalizedMerchant: string;
  rows: readonly DatedTransaction[];
  cadence: DetectedRecurringCadence;
  asOfDate: string | undefined;
  options: ResolvedDetectionOptions;
}): CandidateEvaluation | null {
  const cadenceEvidence = scoreCadence(rows, cadence);
  if (cadenceEvidence.matchingIntervals === 0) return null;

  const requiredMatchingIntervals = rows.length === 2 ? 1 : Math.ceil(cadenceEvidence.totalIntervals * 0.66);
  if (cadenceEvidence.matchingIntervals < requiredMatchingIntervals) return null;

  if (hasDismissedRecurring(normalizedMerchant, cadence, options.existingRecurring)) return null;

  const existingRecurring = findExistingRecurring(normalizedMerchant, cadence, options.existingRecurring);
  const amountEvaluation = evaluateAmounts(rows, existingRecurring, options);
  if (amountEvaluation.score < 0.58) return null;

  const occurrenceScore = Math.min(1, rows.length / 4);
  const recurringSignal = rows.filter((row) => row.transaction.recurring).length / rows.length;
  const confidence = roundScore(
    cadenceEvidence.score * 0.42 +
    amountEvaluation.score * 0.33 +
    occurrenceScore * 0.15 +
    recurringSignal * 0.1
  );

  if (confidence < options.minimumConfidence) return null;

  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) return null;
  if (!existingRecurring && isInactiveCandidate(last, cadence, asOfDate, options)) return null;

  const isNew = existingRecurring === null || existingRecurring.isNew;
  const flags = buildFlags(isNew, amountEvaluation.priceChange, confidence, last.transaction.id);
  const transactions = rows.map(toCandidateTransaction);
  const candidate: RecurringCandidate = {
    id: candidateId(userId, normalizedMerchant, cadence),
    userId,
    merchant: last.transaction.merchant,
    normalizedMerchant,
    cadence,
    amount: amountEvaluation.amount,
    confidence,
    isNew,
    existingRecurringId: existingRecurring?.id ?? null,
    occurrenceCount: rows.length,
    firstChargeDate: first.transaction.date,
    lastChargeDate: last.transaction.date,
    lastTransactionId: last.transaction.id,
    lastAmount: last.absoluteAmount,
    nextDueDate: calculateNextDueDate(last.transaction.date, cadence, asOfDate),
    accountId: last.transaction.accountId,
    categoryId: last.transaction.categoryId,
    category: last.transaction.category,
    transactions,
    cadenceEvidence,
    amountEvidence: amountEvaluation.evidence,
    priceChange: amountEvaluation.priceChange,
    flags
  };

  return {
    candidate,
    score: confidence
  };
}

function scoreCadence(rows: readonly DatedTransaction[], cadence: DetectedRecurringCadence): RecurringCadenceEvidence {
  const intervalDays = rows.slice(1).map((row, index) => row.day - rows[index].day);
  const config = CADENCE_CONFIG[cadence];
  const intervalScores = intervalDays.map((interval) => {
    if (interval < config.minDays || interval > config.maxDays) return 0;
    return clamp(1 - Math.abs(interval - config.expectedDays) / config.toleranceDays, 0.25, 1);
  });
  const matchingIntervals = intervalScores.filter((score) => score > 0).length;
  const averageFit = average(intervalScores);
  const matchingRatio = intervalScores.length === 0 ? 0 : matchingIntervals / intervalScores.length;
  const score = roundScore(matchingRatio * 0.55 + averageFit * 0.45);

  return {
    intervalDays,
    matchingIntervals,
    totalIntervals: intervalDays.length,
    averageIntervalDays: intervalDays.length > 0 ? roundDays(average(intervalDays)) : null,
    score
  };
}

function evaluateAmounts(
  rows: readonly DatedTransaction[],
  existingRecurring: KnownRecurringExpense | null,
  options: ResolvedDetectionOptions
): AmountEvaluation {
  const amounts = rows.map((row) => row.absoluteAmount);
  const latestRow = rows[rows.length - 1];
  const latestAmount = latestRow?.absoluteAmount ?? 0;
  const historicalAmounts = amounts.slice(0, -1);
  const allBaseline = median(amounts);
  const allScore = amountSimilarityScore(amounts, allBaseline, options);
  const historicalBaseline = historicalAmounts.length > 0 ? median(historicalAmounts) : allBaseline;
  const historicalScore = historicalAmounts.length > 0
    ? amountSimilarityScore(historicalAmounts, historicalBaseline, options)
    : allScore;
  const knownBaseline = existingRecurring
    ? existingRecurring.lastAmount ?? existingRecurring.amount
    : null;

  const knownPriceChange = latestRow && knownBaseline !== null
    ? priceChangeSignal(knownBaseline, latestAmount, latestRow, "known-recurring", options)
    : null;
  const historicalPriceChange = latestRow && historicalAmounts.length >= 2 && historicalScore >= 0.72
    ? priceChangeSignal(historicalBaseline, latestAmount, latestRow, "history", options)
    : null;
  const priceChange = knownPriceChange ?? historicalPriceChange;

  if (priceChange) {
    const evidence = amountEvidence({
      amounts,
      baselineAmount: priceChange.previousAmount,
      score: roundScore(historicalScore * 0.88),
      options
    });

    return {
      amount: priceChange.currentAmount,
      score: evidence.score,
      evidence,
      priceChange
    };
  }

  const evidence = amountEvidence({
    amounts,
    baselineAmount: allBaseline,
    score: allScore,
    options
  });

  return {
    amount: evidence.baselineAmount,
    score: evidence.score,
    evidence,
    priceChange: null
  };
}

function amountSimilarityScore(
  amounts: readonly number[],
  baselineAmount: number,
  options: ResolvedDetectionOptions
): number {
  if (amounts.length === 0) return 0;

  const tolerance = amountTolerance(baselineAmount, options);
  const fitScores = amounts.map((amount) => clamp(1 - Math.abs(amount - baselineAmount) / tolerance, 0, 1));
  const withinTolerance = amounts.filter((amount) => Math.abs(amount - baselineAmount) <= tolerance).length;
  return roundScore((withinTolerance / amounts.length) * 0.7 + average(fitScores) * 0.3);
}

function amountEvidence({
  amounts,
  baselineAmount,
  score,
  options
}: {
  amounts: readonly number[];
  baselineAmount: number;
  score: number;
  options: ResolvedDetectionOptions;
}): RecurringAmountEvidence {
  return {
    baselineAmount: roundMoney(baselineAmount),
    minAmount: roundMoney(Math.min(...amounts)),
    maxAmount: roundMoney(Math.max(...amounts)),
    averageAmount: roundMoney(average(amounts)),
    toleranceAmount: roundMoney(amountTolerance(baselineAmount, options)),
    score: roundScore(score)
  };
}

function priceChangeSignal(
  previousAmount: number,
  currentAmount: number,
  latestRow: DatedTransaction,
  source: RecurringPriceChangeSignal["source"],
  options: ResolvedDetectionOptions
): RecurringPriceChangeSignal | null {
  const deltaAmount = roundMoney(currentAmount - previousAmount);
  const absoluteDelta = Math.abs(deltaAmount);
  const deltaRatio = previousAmount === 0 ? 1 : absoluteDelta / previousAmount;

  if (
    absoluteDelta < options.priceChangeThresholdAmount ||
    deltaRatio < options.priceChangeThresholdRatio
  ) {
    return null;
  }

  return {
    previousAmount: roundMoney(previousAmount),
    currentAmount: roundMoney(currentAmount),
    deltaAmount,
    deltaRatio: roundScore(deltaRatio),
    changedAt: latestRow.transaction.date,
    transactionId: latestRow.transaction.id,
    source
  };
}

function buildFlags(
  isNew: boolean,
  priceChange: RecurringPriceChangeSignal | null,
  confidence: number,
  lastTransactionId: string
): RecurringCandidateFlag[] {
  const flags: RecurringCandidateFlag[] = [];

  if (isNew) {
    flags.push({
      kind: "new-recurring",
      severity: "info",
      transactionIds: [lastTransactionId]
    });
  }

  if (priceChange) {
    flags.push({
      kind: "price-change",
      severity: "warning",
      transactionIds: [priceChange.transactionId],
      priceChange
    });
  }

  if (confidence < 0.78) {
    flags.push({
      kind: "needs-review",
      severity: "warning",
      transactionIds: [lastTransactionId]
    });
  }

  return flags;
}

function toCandidateTransaction(row: DatedTransaction): RecurringCandidateTransaction {
  return {
    id: row.transaction.id,
    date: row.transaction.date,
    amount: row.transaction.amount,
    absoluteAmount: row.absoluteAmount,
    accountId: row.transaction.accountId,
    categoryId: row.transaction.categoryId,
    category: row.transaction.category,
    recurring: row.transaction.recurring,
    reviewItems: [...(row.transaction.reviewItems ?? [])]
  };
}

function findExistingRecurring(
  normalizedMerchant: string,
  cadence: DetectedRecurringCadence,
  existingRecurring: readonly KnownRecurringExpense[]
): KnownRecurringExpense | null {
  const merchantMatches = existingRecurring.filter((expense) =>
    expense.status !== "dismissed" && normalizeRecurringMerchant(expense.merchant) === normalizedMerchant
  );
  return merchantMatches.find((expense) => expense.cadence === cadence) ?? merchantMatches[0] ?? null;
}

function hasDismissedRecurring(
  normalizedMerchant: string,
  cadence: DetectedRecurringCadence,
  existingRecurring: readonly KnownRecurringExpense[]
) {
  return existingRecurring.some((expense) =>
    expense.status === "dismissed" &&
    normalizeRecurringMerchant(expense.merchant) === normalizedMerchant &&
    expense.cadence === cadence
  );
}

function resolveAsOfDate(asOfDate: string | undefined, rows: readonly DatedTransaction[]): string | undefined {
  if (asOfDate && dateToDay(asOfDate) !== null) return asOfDate;
  return rows[rows.length - 1]?.transaction.date;
}

function addCadence(date: string, cadence: DetectedRecurringCadence): string {
  if (cadence === "weekly") return addDays(date, 7);
  if (cadence === "biweekly") return addDays(date, 14);
  if (cadence === "quarterly") return addMonths(date, 3);
  if (cadence === "annual") return addMonths(date, 12);
  return addMonths(date, 1);
}

function isInactiveCandidate(
  last: DatedTransaction,
  cadence: DetectedRecurringCadence,
  asOfDate: string | undefined,
  options: ResolvedDetectionOptions
): boolean {
  if (options.includeInactiveCandidates) return false;

  const asOfDay = asOfDate ? dateToDay(asOfDate) : null;
  if (asOfDay === null) return false;

  const config = CADENCE_CONFIG[cadence];
  const inactiveAfterDays = Math.max(
    config.maxDays,
    config.expectedDays * options.inactiveCandidateGraceIntervals
  );
  return asOfDay - last.day > inactiveAfterDays;
}

function addDays(date: string, days: number): string {
  const parsed = parseDateOnly(date);
  if (!parsed) return date;
  return formatDateOnly(new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days)));
}

function addMonths(date: string, months: number): string {
  const parsed = parseDateOnly(date);
  if (!parsed) return date;

  const targetMonthStart = new Date(Date.UTC(parsed.year, parsed.month - 1 + months, 1));
  const year = targetMonthStart.getUTCFullYear();
  const month = targetMonthStart.getUTCMonth() + 1;
  const day = Math.min(parsed.day, daysInMonth(year, month));
  return formatDateParts(year, month, day);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function parseDateOnly(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function dateToDay(value: string): number | null {
  const parsed = parseDateOnly(value);
  if (!parsed) return null;
  return Math.floor(Date.UTC(parsed.year, parsed.month - 1, parsed.day) / DAY_MS);
}

function formatDateOnly(date: Date): string {
  return formatDateParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function formatDateParts(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function groupKey(userId: string, normalizedMerchant: string): string {
  return `${userId}\u0000${normalizedMerchant}`;
}

function splitGroupKey(key: string): [string, string] {
  const [userId = "", normalizedMerchant = ""] = key.split("\u0000");
  return [userId, normalizedMerchant];
}

function candidateId(userId: string, normalizedMerchant: string, cadence: DetectedRecurringCadence): string {
  const merchantSlug = normalizedMerchant.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${userId}:${merchantSlug}:${cadence}`;
}

function cadenceRank(cadence: DetectedRecurringCadence): number {
  return DEFAULT_ALLOWED_CADENCES.indexOf(cadence);
}

function amountTolerance(amount: number, options: ResolvedDetectionOptions): number {
  return Math.max(options.amountToleranceAmount, Math.abs(amount) * options.amountToleranceRatio);
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[middle - 1] ?? upper) + upper) / 2;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundScore(value: number): number {
  return Math.round(clamp(value, 0, 1) * 10_000) / 10_000;
}

function roundDays(value: number): number {
  return Math.round(value * 10) / 10;
}
