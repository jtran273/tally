import type { RecurringExpenseRecord } from "@/lib/db";
import type { RecurringCandidate } from "@/lib/recurring";
import {
  BadgeAlert,
  CalendarClock,
  Repeat,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { RecurringCandidateActions } from "./recurring-candidate-actions";
import styles from "./recurring.module.css";

interface RecurringViewProps {
  candidates: RecurringCandidate[];
  dataError?: string;
  isConfigured: boolean;
  isSignedIn: boolean;
  recurringExpenses: RecurringExpenseRecord[];
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

function monthlyEquivalent(amount: number, cadence: RecurringExpenseRecord["cadence"] | RecurringCandidate["cadence"]) {
  if (cadence === "weekly") return amount * 52 / 12;
  if (cadence === "biweekly") return amount * 26 / 12;
  if (cadence === "quarterly") return amount / 3;
  if (cadence === "annual") return amount / 12;
  return amount;
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
  return expense.status === "pending" || expense.isNew || (dueIn !== null && dueIn <= 3);
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
  if (status === "pending") return "Needs review";
  return status.charAt(0).toUpperCase() + status.slice(1);
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

function TrackedTable({
  candidateByRecurringId,
  recurringExpenses
}: {
  candidateByRecurringId: Map<string, RecurringCandidate>;
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

            return (
              <div className={styles.tableRow} key={expense.id}>
                <div className={styles.primaryCell}>
                  <strong>{expense.merchant}</strong>
                  <span>{expense.accountName ?? "Connected account"} - last {formatDate(expense.lastChargeDate)}</span>
                  {attention ? <span className={styles.attentionText}>{dueLabel(expense.nextDueDate)}</span> : null}
                  {isActionable ? (
                    <RecurringCandidateActions
                      candidateId={candidate?.id}
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
                  <span>monthly {formatMoney(monthlyEquivalent(expense.amount, expense.cadence))}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CandidateTable({ candidates }: { candidates: RecurringCandidate[] }) {
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
                <span>monthly {formatMoney(monthlyEquivalent(candidate.amount, candidate.cadence))}</span>
              </div>
              <div className={styles.actionCell}>
                <RecurringCandidateActions
                  candidateId={candidate.id}
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

export function RecurringView({
  candidates,
  dataError,
  isConfigured,
  isSignedIn,
  recurringExpenses
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
    (sum, expense) => sum + monthlyEquivalent(expense.amount, expense.cadence),
    0
  );
  const candidateMonthlyTotal = additionalCandidates.reduce(
    (sum, candidate) => sum + monthlyEquivalent(candidate.amount, candidate.cadence),
    0
  );
  const needsAttention = recurringExpenses.filter(needsTrackedAttention).length +
    additionalCandidates.filter((candidate) => candidate.flags.some((flag) => flag.severity === "warning")).length;

  return (
    <div className={styles.shell}>
      <section className={styles.summaryGrid} aria-label="Recurring summary">
        <SummaryCard
          detail="Tracked recurring"
          icon={Repeat}
          value={recurringExpenses.length.toLocaleString("en-US")}
          tone={recurringExpenses.some((expense) => expense.status === "pending") ? "warn" : undefined}
        />
        <SummaryCard
          detail="Monthly estimate"
          icon={CalendarClock}
          value={formatMoney(monthlyTotal)}
          tone="trusted"
        />
        <SummaryCard
          detail="Needs attention"
          icon={BadgeAlert}
          value={needsAttention.toLocaleString("en-US")}
          tone={needsAttention > 0 ? "warn" : undefined}
        />
        <SummaryCard
          detail="New candidates"
          icon={Sparkles}
          value={additionalCandidates.length.toLocaleString("en-US")}
        />
      </section>

      {!isConfigured ? (
        <div className={styles.notice} role="status">
          Supabase is not configured for this environment, so recurring data cannot be loaded.
        </div>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <div className={styles.notice} role="status">
          Sign in with Supabase Auth to load recurring patterns from your Plaid transactions.
        </div>
      ) : null}

      {dataError ? (
        <div className={styles.errorNotice} role="alert">
          {dataError}
        </div>
      ) : null}

      {!canShowData ? null : recurringExpenses.length === 0 && additionalCandidates.length === 0 ? (
        <div className={styles.emptyState}>
          <ShieldCheck size={28} aria-hidden />
          <div>
            <strong>No recurring patterns detected</strong>
            <span>The detector scanned persisted Plaid transactions and did not find a repeated cadence yet.</span>
          </div>
          <Link className={styles.secondaryButton} href="/transactions">
            Open transactions
          </Link>
        </div>
      ) : (
        <>
          {candidateMonthlyTotal > monthlyTotal ? (
            <div className={styles.notice} role="status">
              <TriangleAlert size={14} aria-hidden />
              Detected candidates estimate {formatMoney(candidateMonthlyTotal)} per month from real Plaid rows before review.
            </div>
          ) : null}
          <TrackedTable candidateByRecurringId={candidateByRecurringId} recurringExpenses={visibleRecurringExpenses} />
          <CandidateTable candidates={additionalCandidates} />
        </>
      )}
    </div>
  );
}
