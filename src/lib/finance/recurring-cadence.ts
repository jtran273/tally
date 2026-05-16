import type { RecurringCadence, RecurringExpenseRecord } from "@/lib/db";

export const CADENCE_MONTHLY_FACTOR: Record<RecurringCadence, number> = {
  weekly: 4.345,
  biweekly: 2.1725,
  monthly: 1,
  quarterly: 1 / 3,
  annual: 1 / 12
};

export const CADENCE_LABEL: Record<RecurringCadence, string> = {
  weekly: "Weekly",
  biweekly: "Biweekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  annual: "Annual"
};

export function recurringMonthlyAmount(expense: Pick<RecurringExpenseRecord, "amount" | "cadence">) {
  return Math.abs(expense.amount) * CADENCE_MONTHLY_FACTOR[expense.cadence];
}

export function summarizeRecurringMonthly(
  expenses: readonly Pick<RecurringExpenseRecord, "amount" | "cadence" | "status">[]
) {
  let monthlyTotal = 0;
  let activeCount = 0;
  for (const expense of expenses) {
    if (expense.status !== "active") continue;
    monthlyTotal += recurringMonthlyAmount(expense);
    activeCount += 1;
  }
  return { activeCount, monthlyTotal };
}
