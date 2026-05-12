import assert from "node:assert/strict";
import test from "node:test";
import { isOpenAiAutoReviewEnabled } from "./server";

test("isOpenAiAutoReviewEnabled only enables automatic token usage with an explicit true flag", () => {
  const previous = process.env.ENABLE_OPENAI_AUTO_REVIEW;

  try {
    delete process.env.ENABLE_OPENAI_AUTO_REVIEW;
    assert.equal(isOpenAiAutoReviewEnabled(), false);

    process.env.ENABLE_OPENAI_AUTO_REVIEW = "false";
    assert.equal(isOpenAiAutoReviewEnabled(), false);

    process.env.ENABLE_OPENAI_AUTO_REVIEW = "true";
    assert.equal(isOpenAiAutoReviewEnabled(), true);
  } finally {
    if (previous === undefined) {
      delete process.env.ENABLE_OPENAI_AUTO_REVIEW;
    } else {
      process.env.ENABLE_OPENAI_AUTO_REVIEW = previous;
    }
  }
});
