import assert from "node:assert/strict";
import test from "node:test";
import {
  CADENCE_LABEL,
  CADENCE_MONTHLY_FACTOR,
  recurringMonthlyAmount,
  summarizeRecurringMonthly
} from "./recurring-cadence";

test("recurringMonthlyAmount normalizes each cadence to a monthly value", () => {
  assert.equal(recurringMonthlyAmount({ amount: 20, cadence: "monthly" }), 20);
  assert.equal(recurringMonthlyAmount({ amount: 12, cadence: "annual" }), 1);
  assert.equal(recurringMonthlyAmount({ amount: 60, cadence: "quarterly" }), 20);
  assert.ok(Math.abs(recurringMonthlyAmount({ amount: 10, cadence: "weekly" }) - 43.45) < 1e-6);
  assert.ok(Math.abs(recurringMonthlyAmount({ amount: 10, cadence: "biweekly" }) - 21.725) < 1e-6);
});

test("recurringMonthlyAmount uses the absolute amount so signed expenses still produce positive monthly", () => {
  assert.equal(recurringMonthlyAmount({ amount: -25, cadence: "monthly" }), 25);
});

test("CADENCE_MONTHLY_FACTOR and CADENCE_LABEL cover every cadence value", () => {
  const cadences = ["weekly", "biweekly", "monthly", "quarterly", "annual"] as const;
  for (const cadence of cadences) {
    assert.ok(CADENCE_MONTHLY_FACTOR[cadence] > 0, `monthly factor for ${cadence}`);
    assert.ok(CADENCE_LABEL[cadence].length > 0, `label for ${cadence}`);
  }
});

test("summarizeRecurringMonthly only counts active expenses", () => {
  const summary = summarizeRecurringMonthly([
    { amount: 20, cadence: "monthly", status: "active" },
    { amount: 12, cadence: "annual", status: "active" },
    { amount: 99, cadence: "monthly", status: "pending" },
    { amount: 99, cadence: "monthly", status: "paused" },
    { amount: 99, cadence: "monthly", status: "dismissed" }
  ]);

  assert.equal(summary.activeCount, 2);
  assert.equal(summary.monthlyTotal, 21);
});

test("summarizeRecurringMonthly returns zeros when nothing is active", () => {
  const summary = summarizeRecurringMonthly([
    { amount: 20, cadence: "monthly", status: "pending" }
  ]);
  assert.equal(summary.activeCount, 0);
  assert.equal(summary.monthlyTotal, 0);
});
