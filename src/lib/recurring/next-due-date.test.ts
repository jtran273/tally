import assert from "node:assert/strict";
import test from "node:test";

import { calculateNextDueDate } from "./detector";

test("calculateNextDueDate preserves month-end anchors while fast-forwarding", () => {
  assert.equal(
    calculateNextDueDate("2026-01-31", "monthly", "2026-03-01"),
    "2026-03-31"
  );
  assert.equal(
    calculateNextDueDate("2026-01-31", "quarterly", "2026-05-01"),
    "2026-07-31"
  );
});

test("calculateNextDueDate fast-forwards day-based cadences from the original anchor", () => {
  assert.equal(
    calculateNextDueDate("2026-01-05", "weekly", "2026-01-20"),
    "2026-01-26"
  );
  assert.equal(
    calculateNextDueDate("2026-01-05", "biweekly", "2026-02-10"),
    "2026-02-16"
  );
});
