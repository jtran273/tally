import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import type { AgentInboxProposal, AgentInboxSummary } from "@/lib/agents/proposal-inbox";
import type { TransactionIntent } from "@/lib/db";
import { getReviewReasonCopy } from "@/lib/review/reasons";
import { AgentInboxActions } from "./agent-inbox-actions";
import styles from "./agent-inbox.module.css";

interface AgentInboxViewProps {
  dataError?: string;
  isConfigured: boolean;
  isDemo: boolean;
  isSignedIn: boolean;
  proposals: AgentInboxProposal[];
  summary: AgentInboxSummary;
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

function SummaryTile({
  detail,
  icon: Icon,
  tone,
  value
}: {
  detail: string;
  icon: LucideIcon;
  tone?: "ok" | "warn";
  value: string;
}) {
  return (
    <div className={`${styles.summaryTile} ${tone ? styles[tone] : ""}`}>
      <span>
        <Icon size={13} aria-hidden />
        {detail}
      </span>
      <strong>{value}</strong>
    </div>
  );
}

function RecommendationList({ proposal }: { proposal: AgentInboxProposal }) {
  const rows = [
    proposal.recommendation.merchantName
      ? ["Merchant", proposal.merchant, proposal.recommendation.merchantName]
      : null,
    proposal.recommendation.categoryName
      ? ["Category", proposal.category, proposal.recommendation.categoryName]
      : null,
    proposal.recommendation.intent
      ? ["Intent", intentLabels[proposal.intent], intentLabels[proposal.recommendation.intent]]
      : null,
    proposal.recommendation.recurring !== undefined
      ? ["Recurring", "Keep current", proposal.recommendation.recurring ? "Yes" : "No"]
      : null,
    proposal.recommendation.confidence !== undefined
      ? ["Confidence", formatConfidence(proposal.confidence), formatConfidence(proposal.recommendation.confidence)]
      : null
  ].filter((row): row is string[] => Boolean(row));

  if (rows.length === 0) {
    return <div className={styles.emptyProposal}>No direct change is ready. Route this item to review.</div>;
  }

  return (
    <div className={styles.changeTable}>
      {rows.map(([label, current, proposed]) => (
        <div className={styles.changeRow} key={label}>
          <span>{label}</span>
          <div>{current}</div>
          <ArrowRight size={13} aria-hidden />
          <strong>{proposed}</strong>
        </div>
      ))}
    </div>
  );
}

function SafeContext({ proposal }: { proposal: AgentInboxProposal }) {
  return (
    <dl className={styles.contextGrid}>
      <div>
        <dt>Account</dt>
        <dd>{proposal.context.accountLabel}</dd>
      </div>
      <div>
        <dt>Institution</dt>
        <dd>{proposal.context.institutionName}</dd>
      </div>
      <div>
        <dt>Provider merchant</dt>
        <dd>{proposal.context.plaidMerchant ?? proposal.context.plaidName ?? "Unavailable"}</dd>
      </div>
      <div>
        <dt>Provider category</dt>
        <dd>{proposal.context.plaidCategory ?? "Unavailable"}</dd>
      </div>
    </dl>
  );
}

function ProposalCard({ isDemo, proposal }: { isDemo: boolean; proposal: AgentInboxProposal }) {
  const reasonCopy = getReviewReasonCopy(proposal.reason);
  const acceptReady = proposal.status === "accept-ready";

  return (
    <article className={styles.proposalCard}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.metaLine}>
            <span className={acceptReady ? styles.readyBadge : styles.reviewBadge}>
              {acceptReady ? "Accept ready" : "Needs review"}
            </span>
            <span>{reasonCopy.shortLabel}</span>
            <span>{formatDate(proposal.date)}</span>
          </div>
          <h2>{proposal.merchant}</h2>
          <p>{proposal.recommendation.rationale}</p>
        </div>
        <div className={styles.amountBlock}>
          <strong>{formatMoney(proposal.amount)}</strong>
          <span>{formatConfidence(proposal.confidence)} confidence</span>
        </div>
      </div>

      <RecommendationList proposal={proposal} />
      <SafeContext proposal={proposal} />

      {proposal.recommendation.signals.length > 0 ? (
        <div className={styles.signalRow}>
          {proposal.recommendation.signals.map((signal) => (
            <span key={signal}>{signal}</span>
          ))}
        </div>
      ) : null}

      <AgentInboxActions
        canApprove={acceptReady}
        isDemo={isDemo}
        reviewItemId={proposal.reviewItemId}
        transactionId={proposal.transactionId}
      />

      <div className={styles.auditLinkRow}>
        <Link href={`/audit?q=${encodeURIComponent(proposal.transactionId)}`}>
          Advanced: audit trail
        </Link>
      </div>
    </article>
  );
}

function EmptyInbox() {
  return (
    <div className={styles.emptyState}>
      <CheckCircle2 size={28} aria-hidden />
      <h2>No proposed finance changes</h2>
      <p>Agent recommendations appear here only after review items have safe, accept-ready suggestions.</p>
      <Link className={styles.secondaryButton} href="/review">
        Open review queue
        <ArrowRight size={14} aria-hidden />
      </Link>
    </div>
  );
}

export function AgentInboxView({
  dataError,
  isConfigured,
  isDemo,
  isSignedIn,
  proposals,
  summary
}: AgentInboxViewProps) {
  const canShowInbox = isConfigured && isSignedIn && !dataError;

  return (
    <div className={styles.shell}>
      <section className={styles.summaryGrid} aria-label="Agent inbox summary">
        <SummaryTile detail="Proposals" icon={ClipboardList} value={summary.totalCount.toLocaleString("en-US")} />
        <SummaryTile
          detail="Accept ready"
          icon={ShieldCheck}
          value={summary.acceptReadyCount.toLocaleString("en-US")}
          tone={summary.acceptReadyCount > 0 ? "ok" : undefined}
        />
        <SummaryTile
          detail="Needs review"
          icon={TriangleAlert}
          value={summary.manualReviewCount.toLocaleString("en-US")}
          tone={summary.manualReviewCount > 0 ? "warn" : undefined}
        />
        <SummaryTile detail="Fields proposed" icon={Sparkles} value={summary.proposedFieldCount.toLocaleString("en-US")} />
      </section>

      <section className={styles.safetyPanel} aria-label="Agent inbox safety">
        <ShieldCheck size={17} aria-hidden />
        <div>
          <h2>Proposal-first finance changes</h2>
          <p>
            Approvals apply stored review suggestions to enriched transaction fields. This inbox shows sanitized
            context only and does not expose raw Plaid payloads, provider identifiers, tokens, or secrets.
            {isDemo ? " Demo proposals are preview-only; sign in to a real workspace before approving or dismissing finance changes." : ""}
          </p>
        </div>
      </section>

      {!isConfigured ? (
        <div className={styles.notice} role="status">
          Supabase is not configured for this environment, so persisted agent proposals cannot be loaded.
        </div>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <div className={styles.notice} role="status">
          Sign in with Supabase Auth to load your agent proposal inbox.
        </div>
      ) : null}

      {dataError ? (
        <div className={styles.errorNotice} role="alert">
          {dataError}
        </div>
      ) : null}

      {!canShowInbox ? null : proposals.length === 0 ? (
        <EmptyInbox />
      ) : (
        <div className={styles.proposalStack}>
          {proposals.map((proposal) => (
            <ProposalCard isDemo={isDemo} key={proposal.id} proposal={proposal} />
          ))}
        </div>
      )}
    </div>
  );
}
