import assert from "node:assert/strict";
import test from "node:test";
import type { AccountRecord } from "@/lib/db";
import {
  buildAccountLifecycleHints,
  type AccountLifecycleMetadata,
  type AccountLifecycleTransactionInput
} from "./account-lifecycle";

const AS_OF = "2026-06-04";

function makeAccount(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: "acct-1",
    userId: "user-1",
    institutionId: "ins-1",
    institutionName: "Chase",
    plaidAccountId: "plaid-1",
    name: "Chase Sapphire",
    officialName: null,
    type: "credit",
    subtype: "credit card",
    mask: "1234",
    balance: 0,
    availableBalance: null,
    creditLimit: 10_000,
    currency: "USD",
    color: null,
    isActive: true,
    lastSyncedAt: AS_OF,
    ...overrides
  };
}

test("flags an old no-fee credit card as worth keeping open", () => {
  const account = makeAccount();
  const metadata: AccountLifecycleMetadata[] = [
    { accountId: account.id, annualFee: 0, openedAt: "2010-01-01" }
  ];
  const hints = buildAccountLifecycleHints({
    accounts: [account],
    asOfDate: AS_OF,
    metadata,
    transactions: []
  });
  assert.equal(hints.length, 1);
  assert.equal(hints[0]?.kind, "keep_open_old_no_fee");
  assert.equal(hints[0]?.priority, "low");
  assert.match(hints[0]?.rationale ?? "", /generally worth keeping open/);
  assert.match(hints[0]?.rationale ?? "", /does not recommend closing/);
});

test("skips keep-open hint when annual fee is unknown", () => {
  const account = makeAccount();
  const metadata: AccountLifecycleMetadata[] = [
    { accountId: account.id, openedAt: "2010-01-01" }
  ];
  const hints = buildAccountLifecycleHints({
    accounts: [account],
    asOfDate: AS_OF,
    metadata,
    transactions: []
  });
  assert.equal(hints.find((hint) => hint.kind === "keep_open_old_no_fee"), undefined);
});

test("skips keep-open hint when card is too young", () => {
  const account = makeAccount();
  const metadata: AccountLifecycleMetadata[] = [
    { accountId: account.id, annualFee: 0, openedAt: "2024-01-01" }
  ];
  const hints = buildAccountLifecycleHints({
    accounts: [account],
    asOfDate: AS_OF,
    metadata,
    transactions: []
  });
  assert.equal(hints.length, 0);
});

test("does not flag inactivity when recent activity exists", () => {
  const account = makeAccount();
  const transactions: AccountLifecycleTransactionInput[] = [
    { accountId: account.id, date: "2026-05-20" }
  ];
  const hints = buildAccountLifecycleHints({
    accounts: [account],
    asOfDate: AS_OF,
    transactions
  });
  assert.equal(hints.find((hint) => hint.kind === "inactivity_check"), undefined);
});

test("flags inactivity for an active card with zero balance and >180 days quiet", () => {
  const account = makeAccount();
  const transactions: AccountLifecycleTransactionInput[] = [
    { accountId: account.id, date: "2025-09-01" }
  ];
  const hints = buildAccountLifecycleHints({
    accounts: [account],
    asOfDate: AS_OF,
    transactions
  });
  assert.equal(hints.length, 1);
  assert.equal(hints[0]?.kind, "inactivity_check");
  assert.equal(hints[0]?.priority, "low");
  assert.match(hints[0]?.rationale ?? "", /does not recommend closing/);
});

test("does not flag inactivity when account has a current balance", () => {
  const account = makeAccount({ balance: -300 });
  const transactions: AccountLifecycleTransactionInput[] = [
    { accountId: account.id, date: "2025-09-01" }
  ];
  const hints = buildAccountLifecycleHints({
    accounts: [account],
    asOfDate: AS_OF,
    transactions
  });
  assert.equal(hints.length, 0);
});

test("does not flag inactivity for inactive (closed/archived) accounts", () => {
  const account = makeAccount({ isActive: false });
  const transactions: AccountLifecycleTransactionInput[] = [
    { accountId: account.id, date: "2025-09-01" }
  ];
  const hints = buildAccountLifecycleHints({
    accounts: [account],
    asOfDate: AS_OF,
    transactions
  });
  assert.equal(hints.length, 0);
});

test("ignores non-credit account types", () => {
  const account = makeAccount({ id: "acct-deposit", type: "depository" });
  const transactions: AccountLifecycleTransactionInput[] = [
    { accountId: account.id, date: "2025-09-01" }
  ];
  const metadata: AccountLifecycleMetadata[] = [
    { accountId: account.id, annualFee: 0, openedAt: "2010-01-01" }
  ];
  const hints = buildAccountLifecycleHints({
    accounts: [account],
    asOfDate: AS_OF,
    metadata,
    transactions
  });
  assert.equal(hints.length, 0);
});

test("no hint ever recommends closure", () => {
  const account = makeAccount();
  const metadata: AccountLifecycleMetadata[] = [
    { accountId: account.id, annualFee: 0, openedAt: "2010-01-01" }
  ];
  const transactions: AccountLifecycleTransactionInput[] = [
    { accountId: account.id, date: "2025-09-01" }
  ];
  const hints = buildAccountLifecycleHints({
    accounts: [account],
    asOfDate: AS_OF,
    metadata,
    transactions
  });
  for (const hint of hints) {
    assert.match(hint.rationale, /does not recommend closing/i);
    assert.doesNotMatch(hint.rationale, /you should close|consider closing|close it to save/i);
  }
});

test("dedupe id is stable across calls with the same inputs", () => {
  const account = makeAccount();
  const metadata: AccountLifecycleMetadata[] = [
    { accountId: account.id, annualFee: 0, openedAt: "2010-01-01" }
  ];
  const first = buildAccountLifecycleHints({ accounts: [account], asOfDate: AS_OF, metadata, transactions: [] });
  const second = buildAccountLifecycleHints({ accounts: [account], asOfDate: AS_OF, metadata, transactions: [] });
  assert.equal(first[0]?.id, second[0]?.id);
});
