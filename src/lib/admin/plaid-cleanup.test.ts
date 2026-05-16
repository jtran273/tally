import assert from "node:assert/strict";
import test from "node:test";
import {
  describePlaidCleanupScope,
  PLAID_CLEANUP_CONFIRMATION,
  validatePlaidCleanupOptions,
  type PlaidCleanupOptions
} from "./plaid-cleanup";

const baseOptions: PlaidCleanupOptions = {
  execute: false,
  itemId: "item-1",
  userId: "user-1"
};

test("Plaid cleanup requires exactly one explicit scope", () => {
  assert.doesNotThrow(() => validatePlaidCleanupOptions(baseOptions));
  assert.throws(
    () => validatePlaidCleanupOptions({ execute: false, userId: "user-1" }),
    /exactly one cleanup scope/
  );
  assert.throws(
    () => validatePlaidCleanupOptions({
      execute: false,
      institutionName: "SchoolsFirst Federal Credit Union",
      itemId: "item-1",
      userId: "user-1"
    }),
    /exactly one cleanup scope/
  );
});

test("destructive Plaid cleanup requires the literal confirmation token", () => {
  assert.throws(
    () => validatePlaidCleanupOptions({ ...baseOptions, execute: true }),
    /DELETE_PLAID_ITEM_DATA/
  );
  assert.doesNotThrow(() =>
    validatePlaidCleanupOptions({
      ...baseOptions,
      confirm: PLAID_CLEANUP_CONFIRMATION,
      execute: true
    })
  );
});

test("cleanup scope description is operator-readable", () => {
  assert.equal(
    describePlaidCleanupScope({
      execute: false,
      institutionName: "SchoolsFirst Federal Credit Union",
      userId: "user-1"
    }),
    "institution name SchoolsFirst Federal Credit Union"
  );
});

