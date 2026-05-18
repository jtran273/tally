import type { AiSuggestionProviderKind } from "@/lib/ai/types";
import type { CategoryRecord, ReviewQueueItem, TransactionIntent } from "@/lib/db";
import type { AiSuggestionQualitySummary } from "@/lib/review/quality";
import { AiQualityPanel } from "./ai-quality-panel";
import {
  displayCategoryName,
  displayTransactionIntent,
  transactionTagFromIntent,
  transactionTagLabel
} from "@/lib/finance/classification";
import { getReviewReasonCopy, isPeerToPeerReview } from "@/lib/review/reasons";
import { hasReviewSuggestionValue, normalizeReviewSuggestion } from "@/lib/review/suggestions";
import Link from "next/link";
import { LinkButton, Notice } from "@/components/ui/primitives";
import {
  ArrowRight,
  CheckCircle2,
  Sparkles,
  TriangleAlert
} from "lucide-react";
import { PeerToPeerSplitForm } from "./peer-to-peer-split-form";
import { ReviewItemActions } from "./review-item-actions";
import { ReviewTransactionEditForm } from "./review-transaction-edit-form";
import styles from "./review.module.css";

interface ReviewQueueViewProps {
  aiProviderKind: AiSuggestionProviderKind;
  categories: CategoryRecord[];
  dataError?: string;
  isConfigured: boolean;
  isDemo: boolean;
  isSignedIn: boolean;
  qualitySummary?: AiSuggestionQualitySummary;
  reviewItems: ReviewQueueItem[];
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

function intentDisplay(intent: TransactionIntent) {
  return intentLabels[displayTransactionIntent(intent)];
}

function tagDisplay(intent: TransactionIntent | undefined) {
  if (!intent) return null;
  const tag = transactionTagFromIntent(intent);
  return tag === "none" ? null : transactionTagLabel(tag);
}

function confidenceTone(value: number | null | undefined): "high" | "mid" | "low" | "unknown" {
  if (value === null || value === undefined) return "unknown";
  if (value >= 0.8) return "high";
  if (value >= 0.5) return "mid";
  return "low";
}

function ConfidenceBadge({ value }: { value: number | null | undefined }) {
  const tone = confidenceTone(value);
  const pct = value === null || value === undefined ? 0 : Math.max(0, Math.min(100, Math.round(value * 100)));
  const label = formatConfidence(value);
  return (
    <span
      className={`${styles.confidenceBadge} ${styles[`confidence-${tone}`]}`}
      aria-label={`Confidence ${label}`}
      title={`Confidence ${label}`}
    >
      <span className={styles.confidenceTrack} aria-hidden>
        <span className={styles.confidenceFill} style={{ width: `${pct}%` }} />
      </span>
      <span className={styles.confidenceValue}>{label}</span>
    </span>
  );
}

function ReviewCard({
  aiProviderKind,
  categories,
  isDemo,
  item
}: {
  aiProviderKind: AiSuggestionProviderKind;
  categories: CategoryRecord[];
  isDemo: boolean;
  item: ReviewQueueItem;
}) {
  const suggestion = normalizeReviewSuggestion(item.aiSuggestion);
  const peerToPeer = isPeerToPeerReview(item.reason);
  const hasSuggestion = hasReviewSuggestionValue(suggestion);
  const canAccept = !peerToPeer && hasSuggestion;
  const canDismiss = !peerToPeer;
  const canSuggest = !peerToPeer;
  const sourceLabel = suggestion.sourceLabel ?? (aiProviderKind === "openai" ? "OpenAI" : "Deterministic heuristics");
  const reasonCopy = getReviewReasonCopy(item.reason);
  const suggestedCategory = displayCategoryName(suggestion.categoryName ?? item.transaction.category);
  const suggestedIntent = intentDisplay(suggestion.intent ?? item.transaction.intent);
  const suggestedTag = tagDisplay(suggestion.intent);

  return (
    <article className={styles.reviewCard} id={`review-${item.id}`}>
      <div className={styles.reviewCardHead}>
        <div>
          <h2>{item.transaction.merchant}</h2>
          <div className={styles.metaLine}>
            <span>{formatDate(item.transaction.date)}</span>
            <span>{item.transaction.accountName}</span>
            <span>{reasonCopy.shortLabel}</span>
          </div>
        </div>
        <div className={styles.amountBlock}>
          <strong className={item.transaction.amount >= 0 ? styles.positiveAmount : styles.negativeAmount}>
            {formatSignedMoney(item.transaction.amount)}
          </strong>
          <ConfidenceBadge value={item.confidence} />
        </div>
      </div>

      {peerToPeer ? (
        <p className={styles.cardNote}>Explain what this payment was for, then split it into the right categories.</p>
      ) : hasSuggestion ? (
        <div className={styles.suggestionCompact}>
          <span>{sourceLabel}</span>
          <strong>{suggestedCategory}</strong>
          <span>{suggestedIntent}</span>
          {suggestedTag ? <span>{suggestedTag}</span> : null}
        </div>
      ) : (
        <p className={styles.cardNote}>{reasonCopy.action}</p>
      )}

      <div className={styles.cardActions}>
        {peerToPeer ? (
          <PeerToPeerSplitForm
            categories={categories}
            defaultExplanation={item.transaction.note}
            isDemo={isDemo}
            reviewItemId={item.id}
            suggestion={suggestion}
            transaction={item.transaction}
          />
        ) : (
          <>
            <ReviewItemActions
              aiProviderKind={aiProviderKind}
              canAccept={canAccept}
              canDismiss={canDismiss}
              canSuggest={canSuggest}
              hasSuggestion={hasSuggestion}
              isDemo={isDemo}
              reviewItemId={item.id}
            />
            <ReviewTransactionEditForm
              categories={categories}
              isDemo={isDemo}
              reviewItemId={item.id}
              transaction={item.transaction}
            />
          </>
        )}
      </div>

      <div className={styles.auditLinkRow}>
        <Link href={`/audit?q=${encodeURIComponent(item.transaction.id)}`}>
          View this transaction&apos;s audit history →
        </Link>
      </div>
    </article>
  );
}

function EmptyQueue() {
  return (
    <div className={styles.emptyState}>
      <CheckCircle2 size={28} aria-hidden />
      <h2>Queue clear.</h2>
      <p>New imports land here only when a transaction needs your call.</p>
      <LinkButton href="/transactions">
        Open transactions
        <ArrowRight size={14} aria-hidden />
      </LinkButton>
    </div>
  );
}

export function ReviewQueueView({
  aiProviderKind,
  categories,
  dataError,
  isConfigured,
  isDemo,
  isSignedIn,
  qualitySummary,
  reviewItems
}: ReviewQueueViewProps) {
  const canShowQueue = isConfigured && isSignedIn && !dataError;
  const peerToPeerItems = reviewItems.filter((item) => isPeerToPeerReview(item.reason));
  const aiItems = reviewItems.filter((item) => !isPeerToPeerReview(item.reason));

  return (
    <div className={styles.shell}>
      {!isConfigured ? (
        <Notice role="status">
          Supabase is not configured for this environment, so persisted review items cannot be loaded.
        </Notice>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <Notice role="status">
          Sign in with Supabase Auth to load your persisted review queue.
        </Notice>
      ) : null}

      {dataError ? (
        <Notice role="alert" tone="error">
          {dataError}
        </Notice>
      ) : null}

      {canShowQueue && qualitySummary && qualitySummary.totalReviewedWithSuggestion + qualitySummary.openCount > 0 ? (
        <AiQualityPanel summary={qualitySummary} />
      ) : null}

      {!canShowQueue ? null : reviewItems.length === 0 ? (
        <EmptyQueue />
      ) : (
        <div className={styles.reviewGroups}>
          {peerToPeerItems.length > 0 ? (
            <section className={styles.reviewGroup} aria-labelledby="review-group-p2p">
              <div className={styles.reviewGroupHead}>
                <h2 id="review-group-p2p">
                  <TriangleAlert size={16} aria-hidden /> Peer-to-peer ({peerToPeerItems.length})
                </h2>
                <span>Venmo, Zelle, Cash App and PayPal hide the real merchant — explain each one.</span>
              </div>
              <div className={styles.cardStack}>
                {peerToPeerItems.map((item) => (
                  <ReviewCard aiProviderKind={aiProviderKind} categories={categories} isDemo={isDemo} item={item} key={item.id} />
                ))}
              </div>
            </section>
          ) : null}

          {aiItems.length > 0 ? (
            <section className={styles.reviewGroup} aria-labelledby="review-group-ai">
              <div className={styles.reviewGroupHead}>
                <h2 id="review-group-ai">
                  <Sparkles size={16} aria-hidden /> Categorize ({aiItems.length})
                </h2>
                <span>Accept a clean suggestion, ask AI, or edit manually.</span>
              </div>
              <div className={styles.cardStack}>
                {aiItems.map((item) => (
                  <ReviewCard aiProviderKind={aiProviderKind} categories={categories} isDemo={isDemo} item={item} key={item.id} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
