import type { AiSuggestionProviderKind } from "@/lib/ai/types";
import type { AuditEventRow, CategoryRecord, ReviewQueueItem, TransactionIntent, TransactionRecord } from "@/lib/db";
import { transactionSpendingAmount } from "@/lib/finance/spending";
import {
  getReviewReasonCopy,
  isPeerToPeerReview,
  REVIEW_REASON_ORDER
} from "@/lib/review/reasons";
import { buildBulkReviewPlan } from "@/lib/review/bulk-actions";
import {
  buildAiBulkPreviewMetrics,
  deriveReviewProductivityMetrics,
  type ReviewProductivityGroup
} from "@/lib/review/productivity-metrics";
import { hasReviewSuggestionValue, normalizeReviewSuggestion } from "@/lib/review/suggestions";
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  CircleDollarSign,
  Pencil,
  ShieldCheck,
  TriangleAlert,
  UsersRound,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { ReviewAiActions } from "./review-ai-actions";
import { BulkReviewActions } from "./bulk-review-actions";
import { PeerToPeerSplitForm } from "./peer-to-peer-split-form";
import { ReviewItemActions } from "./review-item-actions";
import styles from "./review.module.css";

interface ReviewQueueViewProps {
  aiProviderKind: AiSuggestionProviderKind;
  allReviewItems: ReviewQueueItem[];
  auditEvents: AuditEventRow[];
  categories: CategoryRecord[];
  dataError?: string;
  isConfigured: boolean;
  isSignedIn: boolean;
  reviewItems: ReviewQueueItem[];
  transactions: TransactionRecord[];
}

interface ReviewTotals {
  openItems: number;
  peerToPeerItems: number;
  peerToPeerTotal: number;
  trustedSpending: number;
  unresolvedSpending: number;
  unresolvedTransactions: number;
}

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
  style: "currency"
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  weekday: "short",
  year: "numeric"
});

const intentLabels: Record<TransactionIntent, string> = {
  business: "Business",
  personal: "Personal",
  reimbursable: "Reimbursable",
  shared: "Shared",
  transfer: "Transfer"
};

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function formatSignedMoney(value: number) {
  const formatted = moneyFormatter.format(Math.abs(value));
  if (value < 0) return `-${formatted}`;
  if (value > 0) return `+${formatted}`;
  return formatted;
}

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatConfidence(value: number | null | undefined) {
  return value === null || value === undefined ? "Unknown" : `${Math.round(value * 100)}%`;
}

function uniqueOpenTransactions(reviewItems: ReviewQueueItem[]) {
  return [...new Map(reviewItems.map((item) => [item.transaction.id, item.transaction])).values()];
}

function calculateTotals(reviewItems: ReviewQueueItem[], transactions: TransactionRecord[]): ReviewTotals {
  const openTransactions = uniqueOpenTransactions(reviewItems);
  const openTransactionIds = new Set(openTransactions.map((transaction) => transaction.id));
  const peerToPeerItems = reviewItems.filter((item) => isPeerToPeerReview(item.reason));

  return {
    openItems: reviewItems.length,
    peerToPeerItems: peerToPeerItems.length,
    peerToPeerTotal: peerToPeerItems.reduce((sum, item) => sum + Math.abs(item.transaction.amount), 0),
    trustedSpending: transactions
      .filter((transaction) => !openTransactionIds.has(transaction.id))
      .reduce((sum, transaction) => sum + transactionSpendingAmount(transaction), 0),
    unresolvedSpending: openTransactions
      .reduce((sum, transaction) => sum + transactionSpendingAmount(transaction), 0),
    unresolvedTransactions: openTransactions.length
  };
}

function groupedReviewItems(reviewItems: ReviewQueueItem[]) {
  return REVIEW_REASON_ORDER
    .map((reason) => ({
      items: reviewItems.filter((item) => item.reason === reason),
      reason
    }))
    .filter((group) => group.items.length > 0);
}

function SummaryCard({
  detail,
  icon: Icon,
  tone,
  value
}: {
  detail: string;
  icon: LucideIcon;
  tone?: "trusted" | "warn";
  value: string;
}) {
  return (
    <div className={`${styles.summaryCard} ${tone ? styles[tone] : ""}`}>
      <span className={styles.summaryLabel}>
        <Icon size={13} aria-hidden />
        {detail}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function formatGroupList(groups: ReviewProductivityGroup[]) {
  if (groups.length === 0) return "No history yet";
  return groups.map((group) => `${group.label} (${group.count})`).join(", ");
}

function ProductivityPanel({
  metrics,
  preview
}: {
  metrics: ReturnType<typeof deriveReviewProductivityMetrics>;
  preview: ReturnType<typeof buildAiBulkPreviewMetrics>;
}) {
  const skippedCount = Object.values(preview.skipped).reduce((sum, count) => sum + count, 0);

  return (
    <section className={styles.aiCleanupPanel} aria-label="AI review productivity metrics">
      <div>
        <div className={styles.eyebrow}>
          <BarChart3 size={13} aria-hidden />
          Review productivity
          <span className={styles.providerBadge}>Safe metrics</span>
        </div>
        <h2>{metrics.savingsScore.toLocaleString("en-US")} reviews saved or avoided</h2>
        <p>
          Accepted AI: {metrics.acceptedSuggestions.toLocaleString("en-US")}.
          Dismissed: {metrics.dismissedSuggestions.toLocaleString("en-US")}.
          Edited manually: {metrics.editedReviews.toLocaleString("en-US")}.
          Repeated avoided: {metrics.repeatedReviewsAvoided.toLocaleString("en-US")}.
        </p>

        <div className={styles.rawContext}>
          <div>
            <span>Reason</span>
            <strong>{formatGroupList(metrics.byReason)}</strong>
          </div>
          <div>
            <span>Category</span>
            <strong>{formatGroupList(metrics.byCategory)}</strong>
          </div>
          <div>
            <span>Merchant</span>
            <strong>{formatGroupList(metrics.byMerchant)}</strong>
          </div>
          <div>
            <span>Provider</span>
            <strong>{formatGroupList(metrics.byProvider)}</strong>
          </div>
        </div>
      </div>

      <div className={styles.lockedPanel}>
        <strong>{preview.acceptReady.toLocaleString("en-US")} safe bulk candidates</strong>
        <span>
          Preview only: {preview.eligible.toLocaleString("en-US")} AI-eligible open reviews checked,
          {` ${skippedCount.toLocaleString("en-US")} skipped`} for peer-to-peer, missing, or stale suggestions.
        </span>
      </div>
    </section>
  );
}

function ReasonGuide() {
  return (
    <section className={styles.reasonGuide} aria-label="Review reason guide">
      {REVIEW_REASON_ORDER.map((reason) => {
        const copy = getReviewReasonCopy(reason);
        return (
          <div className={styles.reasonGuideItem} key={reason}>
            <span className={`${styles.reasonDot} ${styles[`reason-${reason}`]}`} />
            <div>
              <strong>{copy.shortLabel}</strong>
              <span>{copy.description}</span>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function SuggestionRows({ item }: { item: ReviewQueueItem }) {
  const suggestion = normalizeReviewSuggestion(item.aiSuggestion);
  const hasSuggestion = hasReviewSuggestionValue(suggestion);

  return (
    <div className={styles.suggestionGrid}>
      <div className={styles.suggestionColumn}>
        <span className={styles.columnLabel}>Current enrichment</span>
        <dl className={styles.detailList}>
          <div>
            <dt>Category</dt>
            <dd>{item.transaction.category}</dd>
          </div>
          <div>
            <dt>Intent</dt>
            <dd>{intentLabels[item.transaction.intent]}</dd>
          </div>
          <div>
            <dt>Recurring</dt>
            <dd>{item.transaction.recurring ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt>Confidence</dt>
            <dd>{formatConfidence(item.transaction.confidence)}</dd>
          </div>
        </dl>
      </div>

      <div className={styles.suggestionColumn}>
        <span className={styles.columnLabel}>Suggested change</span>
        {hasSuggestion ? (
          <dl className={styles.detailList}>
            <div>
              <dt>Category</dt>
              <dd>{suggestion.categoryName ?? "Keep current"}</dd>
            </div>
            <div>
              <dt>Intent</dt>
              <dd>{suggestion.intent ? intentLabels[suggestion.intent] : "Keep current"}</dd>
            </div>
            <div>
              <dt>Recurring</dt>
              <dd>{suggestion.recurring === undefined ? "Keep current" : suggestion.recurring ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Confidence</dt>
              <dd>{formatConfidence(suggestion.confidence)}</dd>
            </div>
          </dl>
        ) : (
          <div className={styles.emptySuggestion}>No accept-ready suggestion is stored for this review item.</div>
        )}
      </div>
    </div>
  );
}

function RawContext({ item }: { item: ReviewQueueItem }) {
  return (
    <div className={styles.rawContext}>
      <div>
        <span>Raw merchant</span>
        <strong>{item.transaction.plaidMerchant ?? item.transaction.plaidName ?? "Unavailable"}</strong>
      </div>
      <div>
        <span>Raw name</span>
        <strong>{item.transaction.plaidName ?? "Unavailable"}</strong>
      </div>
      <div>
        <span>Raw category</span>
        <strong>{item.transaction.plaidCategory ?? "Unavailable"}</strong>
      </div>
      <div>
        <span>Account</span>
        <strong>
          {item.transaction.accountName}
          {item.transaction.accountMask ? ` - ${item.transaction.accountMask}` : ""}
        </strong>
      </div>
      <div>
        <span>Institution</span>
        <strong>{item.transaction.institutionName}</strong>
      </div>
    </div>
  );
}

function ReviewCard({ categories, item }: { categories: CategoryRecord[]; item: ReviewQueueItem }) {
  const copy = getReviewReasonCopy(item.reason);
  const suggestion = normalizeReviewSuggestion(item.aiSuggestion);
  const peerToPeer = isPeerToPeerReview(item.reason);
  const canAccept = !peerToPeer && hasReviewSuggestionValue(suggestion);
  const canDismiss = !peerToPeer;

  return (
    <article className={styles.reviewCard}>
      <div className={styles.reviewCardHead}>
        <div>
          <div className={styles.reasonLine}>
            <span className={`${styles.reasonDot} ${styles[`reason-${item.reason}`]}`} />
            <span>{copy.label}</span>
          </div>
          <h2>{item.transaction.merchant}</h2>
          <div className={styles.metaLine}>
            <span>{formatDate(item.transaction.date)}</span>
            <span>{item.transaction.status}</span>
            <span>{item.explanation}</span>
          </div>
        </div>
        <div className={styles.amountBlock}>
          <strong className={item.transaction.amount >= 0 ? styles.positiveAmount : styles.negativeAmount}>
            {formatSignedMoney(item.transaction.amount)}
          </strong>
          <span>{formatConfidence(item.confidence)} review confidence</span>
        </div>
      </div>

      <div className={styles.reasonCallout}>
        <TriangleAlert size={14} aria-hidden />
        <div>
          <strong>{copy.action}</strong>
          {suggestion.reason ? <span>{suggestion.reason}</span> : <span>{copy.description}</span>}
        </div>
      </div>

      <SuggestionRows item={item} />
      <RawContext item={item} />

      <div className={styles.cardActions}>
        {peerToPeer ? (
          <PeerToPeerSplitForm
            categories={categories}
            defaultExplanation={item.transaction.note}
            reviewItemId={item.id}
            suggestion={suggestion}
            transaction={item.transaction}
          />
        ) : (
          <ReviewItemActions canAccept={canAccept} canDismiss={canDismiss} reviewItemId={item.id} />
        )}

        <Link className={styles.secondaryButton} href={`/transactions/${item.transaction.id}`}>
          <Pencil size={14} aria-hidden />
          Edit transaction
        </Link>
      </div>
    </article>
  );
}

function EmptyQueue() {
  return (
    <div className={styles.emptyState}>
      <CheckCircle2 size={28} aria-hidden />
      <h2>No open review items</h2>
      <p>Open review items are generated from persisted Plaid transactions, and none are currently unresolved.</p>
      <Link className={styles.secondaryButton} href="/transactions">
        Open transactions
        <ArrowRight size={14} aria-hidden />
      </Link>
    </div>
  );
}

export function ReviewQueueView({
  aiProviderKind,
  allReviewItems,
  auditEvents,
  categories,
  dataError,
  isConfigured,
  isSignedIn,
  reviewItems,
  transactions
}: ReviewQueueViewProps) {
  const canShowQueue = isConfigured && isSignedIn && !dataError;
  const totals = calculateTotals(reviewItems, transactions);
  const groups = groupedReviewItems(reviewItems);
  const bulkPlan = buildBulkReviewPlan(reviewItems);
  const productivityMetrics = deriveReviewProductivityMetrics({
    auditEvents,
    reviewItems: allReviewItems
  });
  const aiPreview = buildAiBulkPreviewMetrics(reviewItems, categories);

  return (
    <div className={styles.shell}>
      <section className={styles.summaryGrid} aria-label="Review queue summary">
        <SummaryCard
          detail="Open review items"
          icon={TriangleAlert}
          value={totals.openItems.toLocaleString("en-US")}
          tone={totals.openItems > 0 ? "warn" : undefined}
        />
        <SummaryCard
          detail="Trusted spending"
          icon={ShieldCheck}
          value={formatMoney(totals.trustedSpending)}
          tone="trusted"
        />
        <SummaryCard
          detail="Unresolved spending"
          icon={CircleDollarSign}
          value={formatMoney(totals.unresolvedSpending)}
          tone={totals.unresolvedSpending > 0 ? "warn" : undefined}
        />
        <SummaryCard
          detail="Peer-to-peer open"
          icon={UsersRound}
          value={`${totals.peerToPeerItems.toLocaleString("en-US")} / ${formatMoney(totals.peerToPeerTotal)}`}
          tone={totals.peerToPeerItems > 0 ? "warn" : undefined}
        />
      </section>

      {!isConfigured ? (
        <div className={styles.notice} role="status">
          Supabase is not configured for this environment, so persisted review items cannot be loaded.
        </div>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <div className={styles.notice} role="status">
          Sign in with Supabase Auth to load your persisted review queue.
        </div>
      ) : null}

      {dataError ? (
        <div className={styles.errorNotice} role="alert">
          {dataError}
        </div>
      ) : null}

      {canShowQueue && reviewItems.length > 0 ? (
        <section className={styles.aiCleanupPanel} aria-label="AI review cleanup">
          <div>
            <div className={styles.eyebrow}>
              AI cleanup
              <span className={styles.providerBadge} title={aiProviderKind === "openai" ? "OpenAI is configured" : "Using deterministic fallback — set OPENAI_API_KEY to enable AI suggestions"}>
                {aiProviderKind === "openai" ? "OpenAI" : "Mock"}
              </span>
            </div>
            <h2>{aiPreview.acceptReady.toLocaleString("en-US")} accept-ready suggestions</h2>
            <p>
              {aiPreview.eligible.toLocaleString("en-US")} review items can receive merchant,
              category, intent, and recurring suggestions from the configured provider.
              {aiPreview.skipped["peer-to-peer"] > 0 ? ` ${aiPreview.skipped["peer-to-peer"].toLocaleString("en-US")} peer-to-peer items still need manual explanation.` : ""}
              {aiProviderKind !== "openai" ? " Suggestions are deterministic (no OPENAI_API_KEY configured)." : ""}
            </p>
          </div>
          <div className={styles.aiCleanupActions}>
            <ReviewAiActions disabled={aiPreview.eligible === 0} />
            <BulkReviewActions plan={bulkPlan} />
          </div>
        </section>
      ) : null}

      {canShowQueue ? (
        <ProductivityPanel metrics={productivityMetrics} preview={aiPreview} />
      ) : null}

      <ReasonGuide />

      {!canShowQueue ? null : reviewItems.length === 0 ? (
        <EmptyQueue />
      ) : (
        <div className={styles.queueLayout}>
          <aside className={styles.groupList} aria-label="Open review groups">
            <div className={styles.groupListHead}>
              <strong>{totals.unresolvedTransactions.toLocaleString("en-US")} transactions</strong>
              <span>Grouped by reason</span>
            </div>
            {groups.map((group) => {
              const copy = getReviewReasonCopy(group.reason);
              return (
                <a className={styles.groupLink} href={`#reason-${group.reason}`} key={group.reason}>
                  <span className={`${styles.reasonDot} ${styles[`reason-${group.reason}`]}`} />
                  <span>{copy.shortLabel}</span>
                  <strong>{group.items.length}</strong>
                </a>
              );
            })}
          </aside>

          <div className={styles.reviewGroups}>
            {groups.map((group) => {
              const copy = getReviewReasonCopy(group.reason);
              return (
                <section className={styles.reviewGroup} id={`reason-${group.reason}`} key={group.reason}>
                  <div className={styles.reviewGroupHead}>
                    <div>
                      <div className={styles.reasonLine}>
                        <span className={`${styles.reasonDot} ${styles[`reason-${group.reason}`]}`} />
                        <span>{copy.shortLabel}</span>
                      </div>
                      <h2>{copy.label}</h2>
                    </div>
                    <span>{group.items.length.toLocaleString("en-US")} open</span>
                  </div>
                  <div className={styles.cardStack}>
                    {group.items.map((item) => (
                      <ReviewCard categories={categories} item={item} key={item.id} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
