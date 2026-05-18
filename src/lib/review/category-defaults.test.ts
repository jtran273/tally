import assert from "node:assert/strict";
import test from "node:test";
import type { CategoryRecord } from "@/lib/db";
import { defaultReviewCategoryId } from "./category-defaults";

const userId = "11111111-1111-1111-1111-111111111111";

function cat(id: string, name: string): CategoryRecord {
  return {
    color: null,
    icon: null,
    id,
    isSystem: true,
    name,
    parentId: null,
    userId
  };
}

const categories = [
  cat("cat-uncategorized", "Uncategorized"),
  cat("cat-food", "Food"),
  cat("cat-shopping", "Shopping"),
  cat("cat-transfer", "Transfer")
];

test("defaultReviewCategoryId prefers concrete suggestion categories", () => {
  assert.equal(
    defaultReviewCategoryId(
      categories,
      { categoryId: "cat-shopping", categoryName: "Shopping" },
      { category: "Uncategorized", categoryId: "cat-uncategorized" }
    ),
    "cat-shopping"
  );
});

test("defaultReviewCategoryId never falls back to Uncategorized as a proposed category", () => {
  assert.equal(
    defaultReviewCategoryId(
      categories,
      { categoryId: null, categoryName: "Uncategorized" },
      { category: "Uncategorized", categoryId: "cat-uncategorized" }
    ),
    "none"
  );
});

test("defaultReviewCategoryId ignores transfer as a spend category default", () => {
  assert.equal(
    defaultReviewCategoryId(
      categories,
      { categoryId: "cat-transfer", categoryName: "Transfer" },
      { category: "Transfer", categoryId: "cat-transfer" }
    ),
    "none"
  );
});
