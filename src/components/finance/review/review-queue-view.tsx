import type { AiSuggestionProviderKind } from "@/lib/ai/types";
import type { CategoryRecord, ReviewQueueItem, TransactionIntent, TransactionRecord } from "@/lib/db";
import { transactionSpendingAmount } from "@/lib/finance/spending";
import { isPeerToPeerReview } from "@/lib/review/reasons";
import { hasReviewSuggestionValue, normalizeReviewSuggestion } from "@/lib/review/suggestions";
import {
  ArrowRight,
  CheckCircle2,
  CircleDollarSign,
  ShieldCheck,
  Sparkles,
  TriangleAlert
} from "lucide-react";
import Link from "next/link";
import { PeerToPeerSplitForm } from "./peer-to-peer-split-form";
import { ReviewItemActions } from "./review-item-actions";
import { ReviewTransactionEditForm } from "./review-transaction-edit-form";
import styles from "./review.module.css";

interface ReviewQueueViewProps {
  aiAutoReviewEnabled: boolean;
  aiProviderKind: AiSuggestionProviderKind;
  categories: CategoryRecord[];
  dataError?: string;
  isConfigured: boolean;
  isSignedIn: boolean;
  reviewItems: ReviewQueueItem[];
  transactions: TransactionRecord[];
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

function ReviewCard({
  categories,
  item
}: {
  categories: CategoryRecord[];
  item: ReviewQueueItem;
}) {
  const suggestion = normalizeReviewSuggestion(item.aiSuggestion);
  const peerToPeer = isPeerToPeerReview(item.reason);
  const hasSuggestion = hasReviewSuggestionValue(suggestion);
  const canAccept = !peerToPeer && hasSuggestion;
  const canDismiss = !peerToPeer;
  const canSuggest = !peerToPeer;
  const sourceLabel = suggestion.sourceLabel ?? "Review rule";

  return (
    <article className={styles.reviewCard} id={`review-${item.id}`}>
      <div className={styles.reviewCardHead}>
        <div>
          <h2>{item.transaction.merchant}</h2>
          <div className={styles.metaLine}>
            <span>{formatDate(item.transaction.date)}</span>
            <span>{item.transaction.accountName}</span>
            <span>{peerToPeer ? "Peer-to-peer" : "Needs review"}</span>
          </div>
        </div>
        <div className={styles.amountBlock}>
          <strong className={item.transaction.amount >= 0 ? styles.positiveAmount : styles.negativeAmount}>
            {formatSignedMoney(item.transaction.amount)}
          </strong>
          <span>{formatConfidence(item.confidence)} confidence</span>
        </div>
      </div>

      {peerToPeer ? (
        <div className={styles.reasonCallout}>
          <TriangleAlert size={14} aria-hidden />
          <div>
            <strong>Explain this peer-to-peer payment.</strong>
            <span>Venmo, Zelle, Cash App, and PayPal hide the real merchant. Split it into real categories below.</span>
          </div>
        </div>
      ) : hasSuggestion ? (
        <div className={styles.suggestionGrid}>
          <div className={styles.suggestionColumn}>
            <div className={styles.suggestionSourceLine}>
              <span className={styles.columnLabel}>Suggested cleanup</span>
              <span className={styles.sourceBadge}>{sourceLabel}</span>
            </div>
            {suggestion.sourceDetail ? (
              <p className={styles.sourceDetail}>{suggestion.sourceDetail}</p>
            ) : null}
            <dl className={styles.detailList}>
              <div>
                <dt>Category</dt>
                <dd>{suggestion.categoryName ?? item.transaction.category}</dd>
              </div>
              <div>
                <dt>Intent</dt>
                <dd>{suggestion.intent ? intentLabels[suggestion.intent] : intentLabels[item.transaction.intent]}</dd>
              </div>
              {suggestion.reason ? (
                <div>
                  <dt>Why</dt>
                  <dd>{suggestion.reason}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </div>
      ) : (
        <div className={styles.reasonCallout}>
          <TriangleAlert size={14} aria-hidden />
          <div>
            <strong>No accept-ready suggestion yet.</strong>
            <span>
              This was flagged by {sourceLabel.toLowerCase()}. Generate a fresh suggestion or edit the transaction below.
            </span>
          </div>
        </div>
      )}

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
          <>
            <ReviewItemActions
              canAccept={canAccept}
              canDismiss={canDismiss}
              canSuggest={canSuggest}
              hasSuggestion={hasSuggestion}
              reviewItemId={item.id}
            />
            <ReviewTransactionEditForm
              categories={categories}
              reviewItemId={item.id}
              transaction={item.transaction}
            />
          </>
        )}
      </div>
    </article>
  );
}

function EmptyQueue() {
  return (
    <div className={styles.emptyState}>
      <CheckCircle2 size={28} aria-hidden />
      <h2>Nothing needs review</h2>
      <p>All transactions are finalized. New imports show up here when rules or suggestions still need human judgment.</p>
      <Link className={styles.secondaryButton} href="/transactions">
        Open transactions
        <ArrowRight size={14} aria-hidden />
      </Link>
    </div>
  );
}

export function ReviewQueueView({
  aiAutoReviewEnabled,
  aiProviderKind,
  categories,
  dataError,
  isConfigured,
  isSignedIn,
  reviewItems,
  transactions
}: ReviewQueueViewProps) {
  const canShowQueue = isConfigured && isSignedIn && !dataError;
  const openTransactionIds = new Set(reviewItems.map((item) => item.transaction.id));
  const unresolvedSpending = reviewItems.reduce(
    (sum, item) => sum + transactionSpendingAmount(item.transaction),
    0
  );
  const trustedSpending = transactions
    .filter((transaction) => !openTransactionIds.has(transaction.id))
    .reduce((sum, transaction) => sum + transactionSpendingAmount(transaction), 0);

  const peerToPeerItems = reviewItems.filter((item) => isPeerToPeerReview(item.reason));
  const aiItems = reviewItems.filter((item) => !isPeerToPeerReview(item.reason));

  return (
    <div className={styles.shell}>
      <section className={styles.summaryGrid} aria-label="Review queue summary">
        <div className={`${styles.summaryCard} ${reviewItems.length > 0 ? styles.warn : ""}`}>
          <span className={styles.summaryLabel}>
            <TriangleAlert size={13} aria-hidden />
            Needs your input
          </span>
          <strong>{reviewItems.length.toLocaleString("en-US")}</strong>
        </div>
        <div className={`${styles.summaryCard} ${styles.trusted}`}>
          <span className={styles.summaryLabel}>
            <ShieldCheck size={13} aria-hidden />
            Trusted spending
          </span>
          <strong>{formatMoney(trustedSpending)}</strong>
        </div>
        <div className={`${styles.summaryCard} ${unresolvedSpending > 0 ? styles.warn : ""}`}>
          <span className={styles.summaryLabel}>
            <CircleDollarSign size={13} aria-hidden />
            Unresolved spending
          </span>
          <strong>{formatMoney(unresolvedSpending)}</strong>
        </div>
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

      {canShowQueue ? (
        <div className={styles.notice} role="status">
          <Sparkles size={13} aria-hidden />
          {aiProviderKind === "openai"
            ? aiAutoReviewEnabled
              ? "Automatic OpenAI cleanup is enabled. Suggestions stay advisory and high-confidence cleanup is audit-backed."
              : "OpenAI is configured, but automatic cleanup is off to save tokens. Generate suggestions only on the review items that need it."
            : "OpenAI is not configured. Refresh uses saved merchant rules and deterministic heuristics."}
        </div>
      ) : null}

      {!canShowQueue ? null : reviewItems.length === 0 ? (
        <EmptyQueue />
      ) : (
        <div className={styles.reviewGroups}>
          {peerToPeerItems.length > 0 ? (
            <section className={styles.reviewGroup}>
              <div className={styles.reviewGroupHead}>
                <h2>Peer-to-peer ({peerToPeerItems.length})</h2>
                <span>Venmo, Zelle, Cash App and PayPal hide the real merchant — explain each one.</span>
              </div>
              <div className={styles.cardStack}>
                {peerToPeerItems.map((item) => (
                  <ReviewCard categories={categories} item={item} key={item.id} />
                ))}
              </div>
            </section>
          ) : null}

          {aiItems.length > 0 ? (
            <section className={styles.reviewGroup}>
              <div className={styles.reviewGroupHead}>
                <h2>Needs cleanup ({aiItems.length})</h2>
                <span>Source labels show whether the suggestion came from OpenAI, saved rules, or local heuristics.</span>
              </div>
              <div className={styles.cardStack}>
                {aiItems.map((item) => (
                  <ReviewCard categories={categories} item={item} key={item.id} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
