import type { AiProviderStatus } from "@/lib/ai/server";
import type { AccountRecord, RecurringExpenseRecord, ReviewQueueItem, TransactionRecord } from "@/lib/db";
import type { PlaidConnectionSummary } from "@/lib/plaid/service";

export type FirstRunChecklistStatus = "blocked" | "complete" | "current" | "optional";

export interface FirstRunChecklistItem {
  actionHref: string;
  actionLabel: string;
  detail: string;
  group: "finance" | "optional";
  id: "auth" | "plaid" | "sync" | "review" | "recurring" | "ai";
  status: FirstRunChecklistStatus;
  title: string;
}

export interface FirstRunChecklistInput {
  accounts: readonly AccountRecord[];
  aiProviderStatus: AiProviderStatus;
  dataError?: string;
  isConfigured: boolean;
  isDemo: boolean;
  isSignedIn: boolean;
  plaidConnections: readonly PlaidConnectionSummary[];
  recurringExpenses: readonly RecurringExpenseRecord[];
  reviewItems: readonly ReviewQueueItem[];
  transactions: readonly TransactionRecord[];
}

export interface FirstRunChecklistSummary {
  completedFinanceItems: number;
  financeItems: number;
  items: FirstRunChecklistItem[];
}

function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return `${count.toLocaleString("en-US")} ${count === 1 ? singular : plural}`;
}

function hasUsableSession(input: FirstRunChecklistInput) {
  return input.isConfigured && input.isSignedIn && !input.dataError;
}

export function buildFirstRunChecklist(input: FirstRunChecklistInput): FirstRunChecklistSummary {
  const activePlaidConnections = input.plaidConnections.filter((connection) => connection.status === "active");
  const hasPlaidConnection = activePlaidConnections.length > 0;
  const hasLedgerData = input.accounts.length > 0 && input.transactions.length > 0;
  const hasOpenReviewItems = input.reviewItems.length > 0;
  const pendingRecurring = input.recurringExpenses.filter((expense) => expense.status === "pending").length;
  const confirmedRecurring = input.recurringExpenses.filter((expense) => expense.status === "active").length;
  const sessionReady = hasUsableSession(input);

  const items: FirstRunChecklistItem[] = [
    {
      actionHref: input.isSignedIn ? "/settings" : "/login",
      actionLabel: input.isSignedIn ? "Manage session" : "Open sign in",
      detail: input.isDemo
        ? "Demo mode is active with sample data only. It is safe for local exploration and does not connect real institutions."
        : input.isSignedIn
          ? "Supabase Auth is active for this workspace."
          : input.isConfigured
            ? "Sign in before connecting institutions or loading workspace data."
            : "Configure Supabase before production sign-in can load a workspace.",
      group: "finance",
      id: "auth",
      status: input.isSignedIn ? "complete" : input.isConfigured ? "current" : "blocked",
      title: input.isDemo ? "Use demo workspace" : "Sign in"
    },
    {
      actionHref: "/settings",
      actionLabel: hasPlaidConnection ? "Manage banks" : "Connect bank",
      detail: input.isDemo
        ? `${pluralize(activePlaidConnections.length, "demo institution")} loaded from seeded data.`
        : hasPlaidConnection
          ? `${pluralize(activePlaidConnections.length, "institution")} connected through Plaid.`
          : sessionReady
            ? "Connect Plaid to import real accounts and transactions. Sandbox and production copy stay explicit."
            : "Sign in before starting Plaid Link.",
      group: "finance",
      id: "plaid",
      status: hasPlaidConnection ? "complete" : sessionReady ? "current" : "blocked",
      title: "Connect Plaid"
    },
    {
      actionHref: hasLedgerData ? "/transactions" : "/settings",
      actionLabel: hasLedgerData ? "View transactions" : "Sync data",
      detail: hasLedgerData
        ? `${pluralize(input.accounts.length, "account")} and ${pluralize(input.transactions.length, "transaction")} are available in the ledger.`
        : hasPlaidConnection
          ? "Run a Plaid sync so accounts, balances, and transaction rows become available."
          : "Connect Plaid before syncing finance data.",
      group: "finance",
      id: "sync",
      status: hasLedgerData ? "complete" : hasPlaidConnection ? "current" : "blocked",
      title: "Import first data"
    },
    {
      actionHref: "/review",
      actionLabel: hasOpenReviewItems ? "Open review" : "View queue",
      detail: hasOpenReviewItems
        ? `${pluralize(input.reviewItems.length, "item")} need human review before they become trusted budget records.`
        : hasLedgerData
          ? "No open review items are waiting right now."
          : "Import transactions before the review queue can surface cleanup work.",
      group: "finance",
      id: "review",
      status: hasOpenReviewItems ? "current" : hasLedgerData ? "complete" : "blocked",
      title: "Review uncertain transactions"
    },
    {
      actionHref: "/recurring",
      actionLabel: pendingRecurring > 0 ? "Confirm recurring" : "Open recurring",
      detail: pendingRecurring > 0
        ? `${pluralize(pendingRecurring, "candidate")} need confirmation before joining fixed costs.`
        : confirmedRecurring > 0
          ? `${pluralize(confirmedRecurring, "recurring item")} confirmed for planning.`
          : hasLedgerData
            ? "Open recurring to confirm subscriptions and fixed charges detected from history."
            : "Import transactions before recurring charges can be detected.",
      group: "finance",
      id: "recurring",
      status: pendingRecurring > 0 ? "current" : confirmedRecurring > 0 ? "complete" : hasLedgerData ? "current" : "blocked",
      title: "Confirm recurring charges"
    },
    {
      actionHref: "/review",
      actionLabel: "Review suggestions",
      detail: input.aiProviderStatus.configured
        ? input.aiProviderStatus.autoReviewEnabled
          ? `${input.aiProviderStatus.label} is available for automatic advisory cleanup suggestions.`
          : `${input.aiProviderStatus.label} is available for manual suggestions; automatic cleanup is off to save tokens.`
        : "Optional: deterministic fallback suggestions are active until a server-side OpenAI key is configured.",
      group: "optional",
      id: "ai",
      status: input.aiProviderStatus.configured ? "complete" : "optional",
      title: "Enable AI suggestions"
    }
  ];

  const financeItems = items.filter((item) => item.group === "finance").length;
  const completedFinanceItems = items.filter((item) => item.group === "finance" && item.status === "complete").length;

  return {
    completedFinanceItems,
    financeItems,
    items
  };
}
