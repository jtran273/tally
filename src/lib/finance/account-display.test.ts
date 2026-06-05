import assert from "node:assert/strict";
import test from "node:test";
import type { AccountRecord } from "@/lib/db";
import { accountGroupLabel, cleanInstitutionName, friendlyAccountLabel } from "./account-display";

function makeAccount(overrides: Partial<AccountRecord>): AccountRecord {
  return {
    availableBalance: 0,
    balance: 0,
    color: null,
    creditLimit: null,
    currency: "USD",
    id: "account-1",
    institutionId: "institution-1",
    institutionName: "Schools First Federal Credit Union",
    isActive: true,
    lastSyncedAt: null,
    mask: null,
    name: "Primary",
    officialName: null,
    plaidAccountId: "plaid-1",
    subtype: null,
    type: "depository",
    userId: "user-1",
    ...overrides
  } as AccountRecord;
}

test("cleanInstitutionName strips a trailing (manual) suffix and whitespace", () => {
  assert.equal(cleanInstitutionName("Fidelity (manual)"), "Fidelity");
  assert.equal(cleanInstitutionName("Fidelity  (Manual) "), "Fidelity");
  assert.equal(cleanInstitutionName("Schools First Federal Credit Union"), "Schools First Federal Credit Union");
});

test("friendlyAccountLabel uses subtype to distinguish checking, savings, and money market", () => {
  assert.equal(
    friendlyAccountLabel(makeAccount({ subtype: "checking" })),
    "Schools First Federal Credit Union checking"
  );
  assert.equal(
    friendlyAccountLabel(makeAccount({ subtype: "savings" })),
    "Schools First Federal Credit Union savings"
  );
  assert.equal(
    friendlyAccountLabel(makeAccount({ subtype: "money market" })),
    "Schools First Federal Credit Union money market"
  );
});

test("friendlyAccountLabel labels credit, investment, and retirement accounts", () => {
  assert.equal(
    friendlyAccountLabel(makeAccount({ institutionName: "Chase", type: "credit" })),
    "Chase card"
  );
  assert.equal(
    friendlyAccountLabel(makeAccount({ institutionName: "Fidelity (manual)", type: "investment" })),
    "Fidelity investments"
  );
  assert.equal(
    friendlyAccountLabel(makeAccount({ institutionName: "Vanguard", type: "retirement" })),
    "Vanguard retirement"
  );
});

test("friendlyAccountLabel falls back to the account name when institution text is blank", () => {
  assert.equal(
    friendlyAccountLabel(makeAccount({
      institutionName: " (manual) ",
      name: "  Cash envelope  ",
      subtype: "checking",
      type: "depository"
    })),
    "Cash envelope checking"
  );
});

test("accountGroupLabel returns a human-readable group for each account type", () => {
  assert.equal(accountGroupLabel(makeAccount({ type: "depository" })), "Checking & savings");
  assert.equal(accountGroupLabel(makeAccount({ type: "credit" })), "Credit card");
  assert.equal(accountGroupLabel(makeAccount({ type: "investment" })), "Investments");
  assert.equal(accountGroupLabel(makeAccount({ type: "retirement" })), "Retirement");
});
