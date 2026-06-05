import type { AccountRecord } from "@/lib/db";

export type AccountLifecycleHintKind = "keep_open_old_no_fee" | "inactivity_check";
export type AccountLifecycleHintPriority = "low";

export interface AccountLifecycleHint {
  id: string;
  accountId: string;
  accountDisplayName: string;
  kind: AccountLifecycleHintKind;
  priority: AccountLifecycleHintPriority;
  rationale: string;
}

export interface AccountLifecycleMetadata {
  accountId: string;
  annualFee?: number | null;
  openedAt?: string | null;
}

export interface AccountLifecycleTransactionInput {
  accountId: string;
  date: string;
}

const OLD_CARD_AGE_YEARS = 7;
const INACTIVITY_DAYS = 180;
const MAX_DISPLAY_NAME = 60;

function dayDifference(fromIso: string, toIso: string) {
  const from = Date.parse(`${fromIso}T12:00:00.000Z`);
  const to = Date.parse(`${toIso}T12:00:00.000Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / 86_400_000);
}

function accountDisplayName(account: AccountRecord) {
  const trimmed = account.name.trim();
  const withMask = account.mask ? `${trimmed} (…${account.mask})` : trimmed;
  if (withMask.length <= MAX_DISPLAY_NAME) return withMask;
  return `${withMask.slice(0, MAX_DISPLAY_NAME - 1).trimEnd()}…`;
}

function lastTransactionDate(accountId: string, transactions: readonly AccountLifecycleTransactionInput[]) {
  let latest: string | null = null;
  for (const transaction of transactions) {
    if (transaction.accountId !== accountId) continue;
    if (latest === null || transaction.date > latest) latest = transaction.date;
  }
  return latest;
}

function keepOpenHint(
  account: AccountRecord,
  metadata: AccountLifecycleMetadata | undefined,
  asOfDate: string
): AccountLifecycleHint | null {
  if (!metadata) return null;
  if (metadata.annualFee === undefined || metadata.annualFee === null) return null;
  if (metadata.annualFee > 0) return null;
  if (!metadata.openedAt) return null;

  const ageDays = dayDifference(metadata.openedAt, asOfDate);
  if (ageDays === null || ageDays < OLD_CARD_AGE_YEARS * 365) return null;
  if (Math.abs(account.balance) > 0) return null;

  const display = accountDisplayName(account);
  return {
    id: `account-lifecycle:keep-open:${account.id}:${metadata.openedAt}`,
    accountId: account.id,
    accountDisplayName: display,
    kind: "keep_open_old_no_fee",
    priority: "low",
    rationale: `${display} has been open ${Math.floor(ageDays / 365)}+ years with no annual fee. Long-standing no-fee cards are generally worth keeping open unless you have a specific reason to close one. Tally does not recommend closing this card.`
  };
}

function inactivityHint(
  account: AccountRecord,
  asOfDate: string,
  transactions: readonly AccountLifecycleTransactionInput[]
): AccountLifecycleHint | null {
  if (!account.isActive) return null;
  if (Math.abs(account.balance) > 0) return null;

  const latest = lastTransactionDate(account.id, transactions);
  if (!latest) return null;

  const days = dayDifference(latest, asOfDate);
  if (days === null || days < INACTIVITY_DAYS) return null;

  const display = accountDisplayName(account);
  return {
    id: `account-lifecycle:inactivity:${account.id}:${latest}`,
    accountId: account.id,
    accountDisplayName: display,
    kind: "inactivity_check",
    priority: "low",
    rationale: `${display} has no recent activity (last transaction ${latest}, ${days} days ago). Some issuers close inactive cards. A small recurring charge can keep it active if you want to preserve account age. Tally does not recommend closing this card.`
  };
}

export function buildAccountLifecycleHints({
  accounts,
  asOfDate,
  metadata = [],
  transactions
}: {
  accounts: readonly AccountRecord[];
  asOfDate: string;
  metadata?: readonly AccountLifecycleMetadata[];
  transactions: readonly AccountLifecycleTransactionInput[];
}): AccountLifecycleHint[] {
  const metadataByAccount = new Map(metadata.map((entry) => [entry.accountId, entry]));
  const hints: AccountLifecycleHint[] = [];

  for (const account of accounts) {
    if (account.type !== "credit") continue;

    const keep = keepOpenHint(account, metadataByAccount.get(account.id), asOfDate);
    if (keep) hints.push(keep);

    const inactivity = inactivityHint(account, asOfDate, transactions);
    if (inactivity) hints.push(inactivity);
  }

  return hints;
}
