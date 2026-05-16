import type { RecurringExpenseRecord } from "@/lib/db";
import { monthlyRecurringEquivalent, type UpcomingCashflowTimelineSummary } from "@/lib/finance/cashflow";
import { LinkButton, MetricCard, Notice } from "@/components/ui/primitives";
import type { RecurringCandidate } from "@/lib/recurring";
import {
  BadgeAlert,
  CalendarClock,
  Repeat,
  ShieldCheck,
  Sparkles,
  TriangleAlert
} from "lucide-react";
import { RecurringCandidateActions } from "./recurring-candidate-actions";
import styles from "./recurring.module.css";

interface RecurringViewProps {
  candidates: RecurringCandidate[];
  dataError?: string;
  isConfigured: boolean;
  isDemo: boolean;
  isSignedIn: boolean;
  recurringExpenses: RecurringExpenseRecord[];
  upcomingCashflow: UpcomingCashflowTimelineSummary;
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

const DAY_MS = 86_400_000;

function formatMoney(value: number) {
  return moneyFormatter.format(value);
}

function formatDate(value: string | null) {
  if (!value) return "No charge yet";
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatConfidence(value: number | null | undefined) {
  return value === null || value === undefined ? "Unknown" : `${Math.round(value * 100)}%`;
}

function daysUntil(date: string | null) {
  if (!date) return null;
  const today = new Date();
  const dueDate = new Date(`${date}T12:00:00`);
  const todayNoon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  return Math.round((dueDate.getTime() - todayNoon.getTime()) / DAY_MS);
}

function dueLabel(date: string | null) {
  const days = daysUntil(date);
  if (days === null) return "No schedule";
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days}d`;
}

function needsTrackedAttention(expense: RecurringExpenseRecord) {
  const dueIn = daysUntil(expense.nextDueDate);
  // Includes overdue active bills (dueIn < 0), upcoming within 3 days, new, and pending.
  return expense.status === "pending" || expense.isNew || (dueIn !== null && dueIn <= 3);
}

function isOverdue(expense: RecurringExpenseRecord) {
  if (expense.status !== "active") return false;
  const dueIn = daysUntil(expense.nextDueDate);
  return dueIn !== null && dueIn < 0;
}

function candidateReason(candidate: RecurringCandidate) {
  if (candidate.priceChange) {
    return `Price changed from ${formatMoney(candidate.priceChange.previousAmount)} to ${formatMoney(candidate.priceChange.currentAmount)}`;
  }
  if (candidate.flags.some((flag) => flag.kind === "needs-review")) {
    return "Review cadence or amount variance";
  }
  return `${candidate.occurrenceCount.toLocaleString("en-US")} matching charges`;
}

function statusLabel(status: RecurringExpenseRecord["status"]) {
  if (status === "pending") return "Confirm";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatSignedMoney(value: number) {
  if (value === 0) return formatMoney(0);
  return `${value > 0 ? "+" : "-"}${formatMoney(Math.abs(value))}`;
}

function TrackedTable({
  candidateByRecurringId,
  isDemo,
  recurringExpenses
}: {
  candidateByRecurringId: Map<string, RecurringCandidate>;
  isDemo: boolean;
  recurringExpenses: RecurringExpenseRecord[];
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <div className={styles.eyebrow}>Tracked</div>
          <h2>Recurring expenses</h2>
        </div>
        <span>{recurringExpenses.length.toLocaleString("en-US")} rows</span>
      </div>

      {recurringExpenses.length === 0 ? (
        <div className={styles.emptyMini}>No recurring expenses have been saved from real transactions yet.</div>
      ) : (
        <div className={styles.tableShell}>
          <div className={styles.tableHead}>
            <div>Merchant</div>
            <div>Category</div>
            <div>Cadence</div>
            <div>Next due</div>
            <div>Status</div>
            <div className={styles.amountCell}>Amount</div>
          </div>
          {recurringExpenses.map((expense) => {
            const candidate = candidateByRecurringId.get(expense.id);
            const isActionable = expense.status === "pending" || expense.isNew;
            const attention = needsTrackedAttention(expense);
            const overdue = isOverdue(expense);

            return (
              <div className={`${styles.tableRow} ${overdue ? styles.overdueRow : ""}`} key={expense.id}>
                <div className={styles.primaryCell}>
                  <strong>{expense.merchant}</strong>
                  <span>{expense.accountName ?? "Connected account"} - last {formatDate(expense.lastChargeDate)}</span>
                  {overdue ? (
                    <span className={styles.overdueBadge} role="status">
                      <BadgeAlert size={12} aria-hidden /> Missed payment - {dueLabel(expense.nextDueDate)}
                    </span>
                  ) : attention ? (
                    <span className={styles.attentionText}>{dueLabel(expense.nextDueDate)}</span>
                  ) : null}
                  {isActionable ? (
                    <RecurringCandidateActions
                      candidateId={candidate?.id}
                      isDemo={isDemo}
                      merchant={expense.merchant}
                      recurringExpenseId={expense.id}
                    />
                  ) : null}
                </div>
                <div>{expense.category ?? "Uncategorized"}</div>
                <div className={styles.cadence}>{expense.cadence}</div>
                <div>
                  <strong className={styles.nextDue}>{formatDate(expense.nextDueDate)}</strong>
                  <span className={styles.mutedBlock}>{dueLabel(expense.nextDueDate)}</span>
                </div>
                <div>
                  <span className={`${styles.statusPill} ${styles[`status-${expense.status}`]}`}>
                    {statusLabel(expense.status)}
                  </span>
                </div>
                <div className={styles.amountCell}>
                  <strong>{formatMoney(expense.amount)}</strong>
                  <span>monthly {formatMoney(monthlyRecurringEquivalent(expense.amount, expense.cadence))}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CandidateTable({ candidates, isDemo }: { candidates: RecurringCandidate[]; isDemo: boolean }) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <div className={styles.eyebrow}>Detected</div>
          <h2>Patterns from real transactions</h2>
        </div>
        <span>{candidates.length.toLocaleString("en-US")} candidates</span>
      </div>

      {candidates.length === 0 ? (
        <div className={styles.emptyMini}>No additional recurring patterns were detected from the connected Plaid rows.</div>
      ) : (
        <div className={`${styles.tableShell} ${styles.candidateTableShell}`}>
          <div className={styles.tableHead}>
            <div>Merchant</div>
            <div>Cadence</div>
            <div>Occurrences</div>
            <div>Next due</div>
            <div>Confidence</div>
            <div className={styles.amountCell}>Amount</div>
            <div>Actions</div>
          </div>
          {candidates.map((candidate) => (
            <div className={styles.tableRow} key={candidate.id}>
              <div className={styles.primaryCell}>
                <strong>{candidate.merchant}</strong>
                <span>{candidate.category ?? "Uncategorized"} - first {formatDate(candidate.firstChargeDate)}</span>
              </div>
              <div className={styles.cadence}>{candidate.cadence}</div>
              <div>{candidate.occurrenceCount.toLocaleString("en-US")}</div>
              <div>{formatDate(candidate.nextDueDate)}</div>
              <div>
                <strong className={styles.nextDue}>{formatConfidence(candidate.confidence)}</strong>
                <span className={styles.mutedBlock}>{candidateReason(candidate)}</span>
              </div>
              <div className={styles.amountCell}>
                <strong>{formatMoney(candidate.amount)}</strong>
                <span>monthly {formatMoney(monthlyRecurringEquivalent(candidate.amount, candidate.cadence))}</span>
              </div>
              <div className={styles.actionCell}>
                <RecurringCandidateActions
                  candidateId={candidate.id}
                  isDemo={isDemo}
                  merchant={candidate.merchant}
                  recurringExpenseId={candidate.existingRecurringId ?? undefined}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function UpcomingCashflowPanel({ summary }: { summary: UpcomingCashflowTimelineSummary }) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <div className={styles.eyebrow}>Readiness</div>
          <h2>Next 30 days</h2>
        </div>
        <span>{formatSignedMoney(summary.netTotal)}</span>
      </div>
      <div className={styles.timelineSummary}>
        <div>
          <span>Scheduled income</span>
          <strong className={styles.positiveText}>{formatMoney(summary.incomeTotal)}</strong>
        </div>
        <div>
          <span>Scheduled bills</span>
          <strong className={styles.negativeText}>{formatMoney(summary.billTotal)}</strong>
        </div>
        <div>
          <span>Cash after schedule</span>
          <strong>{summary.projectedCashBalance === null ? "No cash accounts" : formatMoney(summary.projectedCashBalance)}</strong>
        </div>
      </div>
      {summary.events.length === 0 ? (
        <div className={styles.emptyMini}>No recurring income or bills are scheduled in this window.</div>
      ) : (
        <div className={styles.timelineList}>
          {summary.events.slice(0, 8).map((event) => (
            <div className={styles.timelineRow} key={event.id}>
              <div>
                <strong>{event.merchant}</strong>
                <span>
                  {formatDate(event.date)} - {event.cadence}
                  {event.source === "transaction-history" ? " - projected from history" : ""}
                  {event.status === "pending" ? " - pending" : ""}
                </span>
              </div>
              <span className={event.direction === "income" ? styles.positiveText : styles.negativeText}>
                {formatSignedMoney(event.direction === "income" ? event.amount : -event.amount)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function RecurringView({
  candidates,
  dataError,
  isConfigured,
  isDemo,
  isSignedIn,
  recurringExpenses,
  upcomingCashflow
}: RecurringViewProps) {
  const canShowData = isConfigured && isSignedIn && !dataError;
  const candidateByRecurringId = new Map(
    candidates
      .filter((candidate) => candidate.existingRecurringId)
      .map((candidate) => [candidate.existingRecurringId as string, candidate])
  );
  const additionalCandidates = candidates
    .filter((candidate) => candidate.isNew)
    .sort((a, b) => {
      const aAttention = a.flags.some((flag) => flag.severity === "warning") ? 0 : 1;
      const bAttention = b.flags.some((flag) => flag.severity === "warning") ? 0 : 1;
      if (aAttention !== bAttention) return aAttention - bAttention;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.nextDueDate.localeCompare(b.nextDueDate);
    });
  const visibleRecurringExpenses = [...recurringExpenses].sort((a, b) => {
    const aAttention = needsTrackedAttention(a) ? 0 : 1;
    const bAttention = needsTrackedAttention(b) ? 0 : 1;
    if (aAttention !== bAttention) return aAttention - bAttention;
    return a.nextDueDate.localeCompare(b.nextDueDate);
  });
  const commitmentExpenses = recurringExpenses.filter((expense) => expense.status === "active" || expense.status === "pending");
  const monthlyTotal = commitmentExpenses.reduce(
    (sum, expense) => sum + monthlyRecurringEquivalent(expense.amount, expense.cadence),
    0
  );
  const candidateMonthlyTotal = additionalCandidates.reduce(
    (sum, candidate) => sum + monthlyRecurringEquivalent(candidate.amount, candidate.cadence),
    0
  );
  const needsAttention = recurringExpenses.filter(needsTrackedAttention).length +
    additionalCandidates.filter((candidate) => candidate.flags.some((flag) => flag.severity === "warning")).length;

  return (
    <div className={styles.shell}>
      <section className={styles.summaryGrid} aria-label="Recurring summary">
        <MetricCard
          label={<><Repeat size={13} aria-hidden />Tracked recurring</>}
          value={recurringExpenses.length.toLocaleString("en-US")}
          tone={recurringExpenses.some((expense) => expense.status === "pending") ? "warning" : "neutral"}
        />
        <MetricCard
          label={<><CalendarClock size={13} aria-hidden />Monthly estimate</>}
          value={formatMoney(monthlyTotal)}
          tone="trusted"
        />
        <MetricCard
          label={<><BadgeAlert size={13} aria-hidden />To confirm</>}
          value={needsAttention.toLocaleString("en-US")}
          tone={needsAttention > 0 ? "warning" : "neutral"}
        />
        <MetricCard
          label={<><Sparkles size={13} aria-hidden />New candidates</>}
          value={additionalCandidates.length.toLocaleString("en-US")}
        />
      </section>

      {!isConfigured ? (
        <Notice role="status">
          Supabase is not configured for this environment, so recurring data cannot be loaded.
        </Notice>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <Notice role="status">
          Sign in with Supabase Auth to load recurring patterns from your Plaid transactions.
        </Notice>
      ) : null}

      {dataError ? (
        <Notice role="alert" tone="error">
          {dataError}
        </Notice>
      ) : null}

      {isDemo && canShowData ? (
        <Notice role="status">
          Demo recurring patterns are read-only. Sign in to confirm or dismiss real recurring rows.
        </Notice>
      ) : null}

      {!canShowData ? null : recurringExpenses.length === 0 && additionalCandidates.length === 0 ? (
        <div className={styles.emptyState}>
          <ShieldCheck size={28} aria-hidden />
          <div>
            <strong>No recurring patterns detected</strong>
            <span>The detector scanned persisted Plaid transactions and did not find a repeated cadence yet.</span>
          </div>
          <LinkButton href="/transactions">
            Open transactions
          </LinkButton>
        </div>
      ) : (
        <>
          {candidateMonthlyTotal > monthlyTotal ? (
            <Notice role="status" tone="warning">
              <TriangleAlert size={14} aria-hidden />
              Detected candidates estimate {formatMoney(candidateMonthlyTotal)} per month from real Plaid rows before review.
            </Notice>
          ) : null}
          <UpcomingCashflowPanel summary={upcomingCashflow} />
          <TrackedTable candidateByRecurringId={candidateByRecurringId} isDemo={isDemo} recurringExpenses={visibleRecurringExpenses} />
          <CandidateTable candidates={additionalCandidates} isDemo={isDemo} />
        </>
      )}
    </div>
  );
}
