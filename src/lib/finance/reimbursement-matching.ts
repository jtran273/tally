import type { TransactionIntent, TransactionStatus } from "@/lib/db";
import { summarizeTransactionReimbursement } from "./reimbursements";

export type ReimbursementMatchConfidence = "high" | "medium" | "low";

export interface ReimbursementMatchExpense {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
  intent: TransactionIntent;
  splits: Parameters<typeof summarizeTransactionReimbursement>[0]["splits"];
  reimbursements: Parameters<typeof summarizeTransactionReimbursement>[0]["reimbursements"];
}

export interface ReimbursementMatchInflow {
  id: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
  intent: TransactionIntent;
  status?: TransactionStatus;
  alreadyLinked?: boolean;
  note?: string | null;
}

export interface ReimbursementMatchSuggestion {
  expenseId: string;
  inflowIds: string[];
  expectedAmount: number;
  matchedAmount: number;
  unmatchedAmount: number;
  score: number;
  confidence: ReimbursementMatchConfidence;
  reasons: string[];
}

export interface SuggestReimbursementMatchesOptions {
  maxInflowCandidates?: number;
  maxCombinationSize?: number;
  maxSuggestionsPerExpense?: number;
}

interface ScoredInflowGroup {
  amountKind: "exact" | "partial" | "over";
  inflows: ReimbursementMatchInflow[];
  matchedAmount: number;
}

const DEFAULT_MAX_INFLOW_CANDIDATES = 12;
const DEFAULT_MAX_COMBINATION_SIZE = 3;
const DEFAULT_MAX_SUGGESTIONS_PER_EXPENSE = 5;
const MONEY_EPSILON = 0.01;
const PEER_TO_PEER_PATTERN = /\b(venmo|zelle|cash app|cashapp|paypal|apple cash)\b/i;
const TRUE_INCOME_PATTERN = /\b(payroll|salary|direct deposit|paycheck|interest|dividend|bonus|refund|cashback)\b/i;
const REIMBURSABLE_CATEGORY_PATTERN = /\b(food|restaurant|dining|event|travel|hotel|airfare|housing|rent|utilities|gift|entertainment)\b/i;

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function daysBetween(left: string, right: string) {
  const leftDate = Date.parse(`${left}T12:00:00.000Z`);
  const rightDate = Date.parse(`${right}T12:00:00.000Z`);
  if (!Number.isFinite(leftDate) || !Number.isFinite(rightDate)) return Number.POSITIVE_INFINITY;
  return Math.round((rightDate - leftDate) / 86_400_000);
}

function isPeerToPeerInflow(inflow: ReimbursementMatchInflow) {
  return PEER_TO_PEER_PATTERN.test(`${inflow.merchant} ${inflow.note ?? ""}`);
}

function isTrueIncome(inflow: ReimbursementMatchInflow) {
  return TRUE_INCOME_PATTERN.test(`${inflow.merchant} ${inflow.category} ${inflow.note ?? ""}`);
}

function isCandidateInflow(inflow: ReimbursementMatchInflow) {
  if (inflow.amount <= 0) return false;
  if (inflow.intent === "transfer") return false;
  if (inflow.alreadyLinked) return false;
  if (isTrueIncome(inflow)) return false;
  return true;
}

function unresolvedReimbursementAmount(expense: ReimbursementMatchExpense) {
  if (expense.amount >= 0 || expense.intent === "transfer") return 0;
  const summary = summarizeTransactionReimbursement(expense);
  if (summary.state === "written-off" || summary.state === "reimbursed") return 0;
  return summary.outstandingAmount;
}

function amountKind(matchedAmount: number, expectedAmount: number): ScoredInflowGroup["amountKind"] {
  if (Math.abs(matchedAmount - expectedAmount) <= MONEY_EPSILON) return "exact";
  return matchedAmount < expectedAmount ? "partial" : "over";
}

function amountScore(group: ScoredInflowGroup, expectedAmount: number) {
  if (group.amountKind === "exact") return group.inflows.length === 1 ? 42 : 38;
  if (group.amountKind === "partial") {
    const ratio = group.matchedAmount / expectedAmount;
    if (ratio >= 0.8) return 30;
    if (ratio >= 0.35) return 24;
    return 14;
  }

  const overage = group.matchedAmount - expectedAmount;
  return overage <= Math.max(5, expectedAmount * 0.1) ? 12 : 0;
}

function timingScore(daysAfterExpense: number) {
  if (daysAfterExpense >= 0 && daysAfterExpense <= 14) return 24;
  if (daysAfterExpense >= 15 && daysAfterExpense <= 45) return 14;
  if (daysAfterExpense >= -2 && daysAfterExpense < 0) return 6;
  return 0;
}

function categoryScore(expense: ReimbursementMatchExpense) {
  if (expense.intent === "reimbursable" || expense.intent === "shared") return 8;
  return REIMBURSABLE_CATEGORY_PATTERN.test(expense.category) ? 5 : 0;
}

function confidenceForScore(score: number, amountMatch: ScoredInflowGroup["amountKind"]): ReimbursementMatchConfidence {
  if (score >= 78 && amountMatch === "exact") return "high";
  if (score >= 50) return "medium";
  return "low";
}

function buildReasons(
  expense: ReimbursementMatchExpense,
  group: ScoredInflowGroup,
  expectedAmount: number,
  daysAfterExpense: number
) {
  const reasons: string[] = [];
  if (group.amountKind === "exact") {
    reasons.push(group.inflows.length === 1
      ? "Inflow amount exactly matches the outstanding reimbursement amount."
      : "Multiple inflows add up to the outstanding reimbursement amount.");
  } else if (group.amountKind === "partial") {
    reasons.push("Inflow amount is less than the outstanding reimbursement amount, so this looks like a partial reimbursement.");
  } else {
    reasons.push("Inflow amount is higher than the outstanding reimbursement amount.");
  }

  if (daysAfterExpense >= 0 && daysAfterExpense <= 14) {
    reasons.push("Inflow posted within two weeks after the shared expense.");
  } else if (daysAfterExpense >= 15 && daysAfterExpense <= 45) {
    reasons.push("Inflow posted after the expense, but outside the strongest timing window.");
  } else {
    reasons.push("Timing is weak for this reimbursement match.");
  }

  if (group.inflows.every(isPeerToPeerInflow)) {
    reasons.push("Inflow merchant looks like a peer-to-peer payment provider.");
  }

  if (expense.intent === "reimbursable" || expense.intent === "shared") {
    reasons.push(`Expense is marked ${expense.intent}.`);
  } else if (REIMBURSABLE_CATEGORY_PATTERN.test(expense.category)) {
    reasons.push("Expense category commonly appears in shared reimbursement workflows.");
  }

  if (group.amountKind !== "exact") {
    reasons.push(`${roundMoney(expectedAmount - group.matchedAmount)} remains unmatched.`);
  }

  return reasons;
}

function scoreGroup(expense: ReimbursementMatchExpense, group: ScoredInflowGroup, expectedAmount: number) {
  const earliestInflowDate = group.inflows.reduce(
    (earliest, inflow) => inflow.date < earliest ? inflow.date : earliest,
    group.inflows[0]?.date ?? expense.date
  );
  const daysAfterExpense = daysBetween(expense.date, earliestInflowDate);
  const peerToPeerScore = group.inflows.every(isPeerToPeerInflow) ? 18 : group.inflows.some(isPeerToPeerInflow) ? 10 : 0;
  const score = Math.min(100, Math.max(0, Math.round(
    amountScore(group, expectedAmount) +
    timingScore(daysAfterExpense) +
    peerToPeerScore +
    categoryScore(expense) -
    (group.inflows.length > 1 ? 2 : 0)
  )));

  return {
    confidence: confidenceForScore(score, group.amountKind),
    expectedAmount,
    expenseId: expense.id,
    inflowIds: group.inflows.map((inflow) => inflow.id),
    matchedAmount: group.matchedAmount,
    reasons: buildReasons(expense, group, expectedAmount, daysAfterExpense),
    score,
    unmatchedAmount: roundMoney(Math.max(0, expectedAmount - group.matchedAmount))
  } satisfies ReimbursementMatchSuggestion;
}

function sortInflowsForMatching(expense: ReimbursementMatchExpense, inflows: ReimbursementMatchInflow[]) {
  return [...inflows].sort((left, right) => {
    const leftDays = Math.abs(daysBetween(expense.date, left.date));
    const rightDays = Math.abs(daysBetween(expense.date, right.date));
    return leftDays - rightDays || Math.abs(expense.amount + left.amount) - Math.abs(expense.amount + right.amount) || left.id.localeCompare(right.id);
  });
}

function combinationGroups(
  inflows: ReimbursementMatchInflow[],
  expectedAmount: number,
  maxCombinationSize: number
): ScoredInflowGroup[] {
  const groups: ScoredInflowGroup[] = inflows.map((inflow) => ({
    amountKind: amountKind(inflow.amount, expectedAmount),
    inflows: [inflow],
    matchedAmount: roundMoney(inflow.amount)
  }));

  function visit(start: number, selected: ReimbursementMatchInflow[], amount: number) {
    if (selected.length >= 2) {
      groups.push({
        amountKind: amountKind(amount, expectedAmount),
        inflows: [...selected],
        matchedAmount: roundMoney(amount)
      });
    }
    if (selected.length >= maxCombinationSize) return;

    for (let index = start; index < inflows.length; index += 1) {
      const nextAmount = roundMoney(amount + inflows[index].amount);
      if (nextAmount > expectedAmount + Math.max(5, expectedAmount * 0.1)) continue;
      visit(index + 1, [...selected, inflows[index]], nextAmount);
    }
  }

  visit(0, [], 0);
  return groups;
}

function dedupeSuggestions(suggestions: ReimbursementMatchSuggestion[]) {
  const seen = new Set<string>();
  return suggestions.filter((suggestion) => {
    const key = `${suggestion.expenseId}:${suggestion.inflowIds.join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function suggestReimbursementMatches(
  expenses: readonly ReimbursementMatchExpense[],
  inflows: readonly ReimbursementMatchInflow[],
  options: SuggestReimbursementMatchesOptions = {}
): ReimbursementMatchSuggestion[] {
  const maxInflowCandidates = options.maxInflowCandidates ?? DEFAULT_MAX_INFLOW_CANDIDATES;
  const maxCombinationSize = options.maxCombinationSize ?? DEFAULT_MAX_COMBINATION_SIZE;
  const maxSuggestionsPerExpense = options.maxSuggestionsPerExpense ?? DEFAULT_MAX_SUGGESTIONS_PER_EXPENSE;
  const candidateInflows = inflows.filter(isCandidateInflow);

  return expenses.flatMap((expense) => {
    const expectedAmount = unresolvedReimbursementAmount(expense);
    if (expectedAmount <= 0) return [];

    const rankedInflows = sortInflowsForMatching(expense, candidateInflows).slice(0, maxInflowCandidates);
    return dedupeSuggestions(
      combinationGroups(rankedInflows, expectedAmount, maxCombinationSize)
        .map((group) => scoreGroup(expense, group, expectedAmount))
        .filter((suggestion) => suggestion.score > 0)
        .sort((left, right) =>
          right.score - left.score ||
          left.unmatchedAmount - right.unmatchedAmount ||
          left.inflowIds.length - right.inflowIds.length ||
          left.inflowIds.join("|").localeCompare(right.inflowIds.join("|"))
        )
    ).slice(0, maxSuggestionsPerExpense);
  }).sort((left, right) =>
    right.score - left.score ||
    left.expenseId.localeCompare(right.expenseId) ||
    left.inflowIds.join("|").localeCompare(right.inflowIds.join("|"))
  );
}
