import assert from "node:assert/strict";
import test from "node:test";
import { logSafeError } from "./logging";

test("logSafeError redacts secret-shaped error messages", () => {
  const originalError = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };

  try {
    logSafeError("test_context", new Error("Bearer abcdefghijklmnop and sk-proj-abcdefghijklmnopqrstuv"));
  } finally {
    console.error = originalError;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.[0], "test_context");
  assert.deepEqual(calls[0]?.[1], {
    message: "[redacted] and [redacted]",
    name: "Error"
  });
});
