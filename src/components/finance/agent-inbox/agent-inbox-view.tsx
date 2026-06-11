import {
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import type {
  AgentInboxProposal,
  AgentInboxSummary,
  ReviewAgentInboxProposal
} from "@/lib/agents/proposal-inbox";
import type { TransactionIntent } from "@/lib/db";
import { getReviewReasonCopy } from "@/lib/review/reasons";
import {
  AgentInboxActions,
  MonthlyBudgetActions,
  ReimbursementCandidateActions,
  ReimbursementMatchActions
} from "./agent-inbox-actions";
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

function StatusPill({
  detail,
  icon: Icon
}: {
  detail: string;
  icon: LucideIcon;
}) {
  return (
    <span className={styles.statusPill}>
      <Icon size={13} aria-hidden />
      {detail}
    </span>
  );
}

function RecommendationList({ proposal }: { proposal: ReviewAgentInboxProposal }) {
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

function SafeContext({ proposal }: { proposal: ReviewAgentInboxProposal }) {
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
  if (proposal.action === "monthly-budget") {
    return <MonthlyBudgetCard isDemo={isDemo} proposal={proposal} />;
  }

  if (proposal.action === "reimbursement-candidate") {
    return <ReimbursementCandidateCard isDemo={isDemo} proposal={proposal} />;
  }

  if (proposal.action === "reimbursement-match") {
    return <ReimbursementMatchCard isDemo={isDemo} proposal={proposal} />;
  }

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
        transactionLabel={proposal.merchant}
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

function MonthlyBudgetCard({
  isDemo,
  proposal
}: {
  isDemo: boolean;
  proposal: Extract<AgentInboxProposal, { action: "monthly-budget" }>;
}) {
  return (
    <article className={styles.proposalCard}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.metaLine}>
            <span className={proposal.approvedViaReply ? styles.readyBadge : styles.reviewBadge}>
              {proposal.approvedViaReply ? "Approved via Tally chat" : "Budget proposal"}
            </span>
            <span>{formatDate(proposal.date)}</span>
            <span>{proposal.categories.length} categor{proposal.categories.length === 1 ? "y" : "ies"}</span>
          </div>
          <h2>{proposal.monthLabel} budget</h2>
          <p>
            Tally drafted this plan from your recent spending. Nothing changes until you confirm it
            {proposal.approvedViaReply ? " — you already approved it in chat, this applies it." : "."}
          </p>
        </div>
        <div className={styles.amountBlock}>
          <strong>{moneyFormatter.format(proposal.totalAmount)}</strong>
          <span>planned for {proposal.monthLabel}</span>
        </div>
      </div>

      <div className={styles.changeTable}>
        {proposal.categories.map((category) => (
          <div className={styles.changeRow} key={category.label}>
            <span>{category.label}</span>
            <div>planned</div>
            <ArrowRight size={13} aria-hidden />
            <strong>{moneyFormatter.format(category.amount)}</strong>
          </div>
        ))}
      </div>

      {proposal.uncertaintyNotes.length > 0 ? (
        <div className={styles.signalRow}>
          {proposal.uncertaintyNotes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>
      ) : null}

      <MonthlyBudgetActions
        isDemo={isDemo}
        monthLabel={proposal.monthLabel}
        proposalId={proposal.proposalId}
      />

      <div className={styles.auditLinkRow}>
        <Link href={`/audit?q=${encodeURIComponent(proposal.proposalId)}`}>
          Advanced: audit trail
        </Link>
      </div>
    </article>
  );
}

function ReimbursementCandidateCard({
  isDemo,
  proposal
}: {
  isDemo: boolean;
  proposal: Extract<AgentInboxProposal, { action: "reimbursement-candidate" }>;
}) {
  const topInflow = proposal.candidateInflows[0];

  return (
    <article className={styles.proposalCard}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.metaLine}>
            <span className={styles.reviewBadge}>AI candidate</span>
            <span>{formatDate(proposal.date)}</span>
            <span>
              {proposal.candidateInflows.length > 0
                ? `${proposal.candidateInflows.length} nearby inflow${proposal.candidateInflows.length === 1 ? "" : "s"}`
                : "No inflow yet"}
            </span>
          </div>
          <h2>{proposal.merchant}</h2>
          <p>{proposal.question ?? proposal.recommendation.rationale}</p>
        </div>
        <div className={styles.amountBlock}>
          <strong>{formatMoney(proposal.amount)}</strong>
          <span>{formatConfidence(proposal.confidence)} confidence</span>
        </div>
      </div>

      <div className={styles.changeTable}>
        <div className={styles.changeRow}>
          <span>Expense</span>
          <div>{proposal.category}</div>
          <ArrowRight size={13} aria-hidden />
          <strong>{proposal.recommendation.suggestedIntent ?? "Review reimbursement"}</strong>
        </div>
        <div className={styles.changeRow}>
          <span>Possible inflow</span>
          <div>{topInflow ? topInflow.merchant : "None found yet"}</div>
          <ArrowRight size={13} aria-hidden />
          <strong>{topInflow ? `${formatMoney(topInflow.amount)} on ${formatDate(topInflow.date)}` : "Ask or track expected"}</strong>
        </div>
      </div>

      {proposal.recommendation.signals.length > 0 ? (
        <div className={styles.signalRow}>
          {proposal.recommendation.signals.map((signal) => (
            <span key={signal}>{signal}</span>
          ))}
        </div>
      ) : null}

      <ReimbursementCandidateActions
        isDemo={isDemo}
        proposalId={proposal.proposalId}
        transactionId={proposal.transactionId}
      />

      <div className={styles.auditLinkRow}>
        <Link href={`/audit?q=${encodeURIComponent(proposal.proposalId)}`}>
          Advanced: audit trail
        </Link>
      </div>
    </article>
  );
}

function ReimbursementMatchCard({
  isDemo,
  proposal
}: {
  isDemo: boolean;
  proposal: Extract<AgentInboxProposal, { action: "reimbursement-match" }>;
}) {
  return (
    <article className={styles.proposalCard}>
      <div className={styles.cardHead}>
        <div>
          <div className={styles.metaLine}>
            <span className={styles.readyBadge}>Match suggestion</span>
            <span>{formatDate(proposal.inflow.date)}</span>
            <span>{proposal.reimbursement.counterparty ?? "Unknown counterparty"}</span>
          </div>
          <h2>{proposal.inflow.merchant}</h2>
          <p>{proposal.recommendation.rationale}</p>
        </div>
        <div className={styles.amountBlock}>
          <strong>{formatMoney(proposal.matchAmount)}</strong>
          <span>{formatConfidence(proposal.confidence)} confidence</span>
        </div>
      </div>

      <div className={styles.changeTable}>
        <div className={styles.changeRow}>
          <span>Inflow</span>
          <div>{proposal.inflow.merchant}</div>
          <ArrowRight size={13} aria-hidden />
          <strong>{formatMoney(proposal.inflow.amount)}</strong>
        </div>
        <div className={styles.changeRow}>
          <span>Expense</span>
          <div>{proposal.expense.merchant}</div>
          <ArrowRight size={13} aria-hidden />
          <strong>{formatMoney(proposal.expense.amount)}</strong>
        </div>
        <div className={styles.changeRow}>
          <span>Reimbursement</span>
          <div>{formatMoney(proposal.reimbursement.expectedAmount)} expected</div>
          <ArrowRight size={13} aria-hidden />
          <strong>{proposal.unmatchedAmount > 0 ? `${formatMoney(proposal.unmatchedAmount)} remains` : "Fully matched"}</strong>
        </div>
      </div>

      {proposal.recommendation.signals.length > 0 ? (
        <div className={styles.signalRow}>
          {proposal.recommendation.signals.map((signal) => (
            <span key={signal}>{signal}</span>
          ))}
        </div>
      ) : null}

      <ReimbursementMatchActions
        isDemo={isDemo}
        proposalId={proposal.proposalId}
        transactionId={proposal.inflow.id}
      />

      <div className={styles.auditLinkRow}>
        <Link href={`/audit?q=${encodeURIComponent(proposal.proposalId)}`}>
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
      <p>Agent recommendations appear here after safe review suggestions or reimbursement candidates are available.</p>
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
      <section className={styles.proposalStatus} aria-label="Agent inbox summary">
        <StatusPill
          detail={`${summary.totalCount.toLocaleString("en-US")} shown`}
          icon={ClipboardList}
        />
        {summary.hiddenLowerConfidenceCount > 0 ? (
          <span className={styles.mutedStatus}>
            {summary.hiddenLowerConfidenceCount.toLocaleString("en-US")} lower-confidence hidden
          </span>
        ) : null}
        {summary.acceptReadyCount > 0 ? (
          <span className={styles.mutedStatus}>
            {summary.acceptReadyCount.toLocaleString("en-US")} ready
          </span>
        ) : null}
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
