import assert from "node:assert/strict";
import test from "node:test";
import { listRecurringExpenses } from "@/lib/db";
import {
  createDemoFinanceClient,
  DEMO_USER_ID,
  listDemoPlaidConnections
} from "./finance-client";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

test("demo sync and recurring dates stay fresh for the current run", async () => {
  const today = todayIso();
  const connections = listDemoPlaidConnections();

  assert.ok(connections.length > 0);
  assert.ok(connections.every((connection) => connection.lastSuccessfulSyncAt?.startsWith(today)));

  const recurringExpenses = await listRecurringExpenses(createDemoFinanceClient(), DEMO_USER_ID);

  assert.ok(recurringExpenses.length > 0);
  assert.ok(
    recurringExpenses.every((expense) => expense.nextDueDate >= today),
    "demo recurring rows should not become overdue just because calendar time passed"
  );
});
