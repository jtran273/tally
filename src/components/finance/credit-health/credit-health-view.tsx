"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Plus,
  ShieldCheck,
  TrendingDown,
  TrendingUp
} from "lucide-react";
import { useActionState } from "react";
import { addCreditScoreSnapshotAction, type CreditScoreSnapshotActionState } from "@/app/(app)/credit-health/actions";
import type { CreditScoreSnapshotRecord } from "@/lib/db";
import type { CreditHealthSummary, RewardsBenefitsCapability } from "@/lib/finance/credit-health";
import type { LiabilitiesDueSummary } from "@/lib/finance/liabilities";
import styles from "./credit-health.module.css";

interface CreditHealthViewProps {
  asOfDate: string;
  capability: RewardsBenefitsCapability;
  dataError?: string;
  isConfigured: boolean;
  isDemo: boolean;
  isSignedIn: boolean;
  liabilities: LiabilitiesDueSummary;
  scoreSnapshots: CreditScoreSnapshotRecord[];
  summary: CreditHealthSummary;
}

const initialState: CreditScoreSnapshotActionState = {};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "short",
  year: "numeric"
});

const moneyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency"
});

const sourceLabels = {
  demo: "Demo",
  manual_bureau: "Manual bureau",
  manual_issuer: "Manual issuer"
};

const modelLabels = {
  fico: "FICO",
  unknown: "Unknown model",
  vantagescore: "VantageScore"
};

function formatDate(value: string) {
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

function formatDelta(delta: number | null) {
  if (delta === null) return "No prior snapshot";
  if (delta > 0) return `+${delta}`;
  return String(delta);
}

function scoreTrendLabel(summary: CreditHealthSummary) {
  const current = summary.score.current;
  if (!current) return "Not entered";
  const direction = summary.score.trend === "up"
    ? "up"
    : summary.score.trend === "down"
      ? "down"
      : summary.score.trend === "flat"
        ? "flat"
        : "new";
  return `${current.score} ${direction}`;
}

function trendIcon(trend: CreditHealthSummary["score"]["trend"]) {
  if (trend === "up") return <TrendingUp size={15} aria-hidden />;
  if (trend === "down") return <TrendingDown size={15} aria-hidden />;
  return <Info size={15} aria-hidden />;
}

function SnapshotForm({
  asOfDate,
  isDemo
}: {
  asOfDate: string;
  isDemo: boolean;
}) {
  const [state, formAction, pending] = useActionState(addCreditScoreSnapshotAction, initialState);

  return (
    <form action={formAction} className={styles.snapshotForm}>
      <div className={styles.formGrid}>
        <label>
          <span>Score</span>
          <input disabled={isDemo || pending} inputMode="numeric" max={850} min={300} name="score" placeholder="720" required type="number" />
        </label>
        <label>
          <span>Source</span>
          <select defaultValue="manual_issuer" disabled={isDemo || pending} name="source" required>
            <option value="manual_issuer">Issuer app</option>
            <option value="manual_bureau">Bureau / monitoring app</option>
          </select>
        </label>
        <label>
          <span>Model</span>
          <select defaultValue="unknown" disabled={isDemo || pending} name="model" required>
            <option value="fico">FICO</option>
            <option value="vantagescore">VantageScore</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label>
          <span>Date</span>
          <input defaultValue={asOfDate} disabled={isDemo || pending} max={asOfDate} name="asOfDate" required type="date" />
        </label>
      </div>
      <button className={styles.primaryButton} disabled={isDemo || pending} type="submit">
        <Plus size={14} aria-hidden />
        {pending ? "Saving..." : isDemo ? "Read-only demo" : "Add snapshot"}
      </button>
      {state.error ? <div className={styles.inlineError} role="alert">{state.error}</div> : null}
      {state.message ? <div className={styles.inlineSuccess} role="status">{state.message}</div> : null}
    </form>
  );
}

function ScoreCard({
  asOfDate,
  isDemo,
  snapshots,
  summary
}: {
  asOfDate: string;
  isDemo: boolean;
  snapshots: CreditScoreSnapshotRecord[];
  summary: CreditHealthSummary;
}) {
  const current = summary.score.current;

  return (
    <section className={styles.scorePanel} aria-label="Manual credit score">
      <div className={styles.panelHeader}>
        <div>
          <span className={styles.eyebrow}>Manual score</span>
          <h2>{current ? current.score : "Not entered"}</h2>
        </div>
        <div className={styles.trendPill}>
          {trendIcon(summary.score.trend)}
          {scoreTrendLabel(summary)}
        </div>
      </div>
      <p>{summary.score.sourceCopy}</p>
      {current ? (
        <dl className={styles.scoreMeta}>
          <div>
            <dt>Source</dt>
            <dd>{sourceLabels[current.source]}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{modelLabels[current.model]}</dd>
          </div>
          <div>
            <dt>As of</dt>
            <dd>{formatDate(current.asOfDate)}</dd>
          </div>
          <div>
            <dt>Change</dt>
            <dd>{formatDelta(summary.score.delta)}</dd>
          </div>
        </dl>
      ) : null}
      <SnapshotForm asOfDate={asOfDate} isDemo={isDemo} />
      {snapshots.length > 0 ? (
        <div className={styles.historyList} aria-label="Credit score snapshot history">
          {snapshots.slice(0, 8).map((snapshot) => (
            <div className={styles.historyRow} key={snapshot.id}>
              <strong>{snapshot.score}</strong>
              <span>{formatDate(snapshot.asOfDate)}</span>
              <span>{sourceLabels[snapshot.source]}</span>
              <span>{modelLabels[snapshot.model]}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function UtilizationCard({ liabilities }: { liabilities: LiabilitiesDueSummary }) {
  return (
    <section className={styles.metricGrid} aria-label="Credit utilization">
      <div className={styles.metricTile}>
        <span>Aggregate utilization</span>
        <strong>{liabilities.aggregateUtilizationPercent === null ? "Unknown" : `${liabilities.aggregateUtilizationPercent.toFixed(1)}%`}</strong>
      </div>
      <div className={styles.metricTile}>
        <span>Highest card</span>
        <strong>{liabilities.highestIndividualUtilizationPercent === null ? "Unknown" : `${liabilities.highestIndividualUtilizationPercent.toFixed(1)}%`}</strong>
      </div>
      <div className={styles.metricTile}>
        <span>Total owed</span>
        <strong>{moneyFormatter.format(liabilities.totalOwed)}</strong>
      </div>
      <div className={styles.metricTile}>
        <span>Cash available</span>
        <strong>{moneyFormatter.format(liabilities.cashAvailable)}</strong>
      </div>
    </section>
  );
}

function GuidanceList({ summary }: { summary: CreditHealthSummary }) {
  return (
    <section className={styles.guidancePanel} aria-label="Credit health guidance">
      <div className={styles.sectionHeader}>
        <span className={styles.eyebrow}>Connected-account guidance</span>
        <h2>Use liabilities for actions, not score prediction</h2>
      </div>
      <div className={styles.guidanceList}>
        {summary.guidance.map((item) => (
          <article className={styles.guidanceCard} data-confidence={item.confidence} key={item.title}>
            <div>
              {item.confidence === "high" ? <CheckCircle2 size={16} aria-hidden /> : item.confidence === "none" ? <AlertTriangle size={16} aria-hidden /> : <Info size={16} aria-hidden />}
              <strong>{item.title}</strong>
            </div>
            <p>{item.reason}</p>
            <span>{item.confidence} confidence</span>
          </article>
        ))}
      </div>
    </section>
  );
}

function RewardsStatus({ capability }: { capability: RewardsBenefitsCapability }) {
  return (
    <section className={styles.rewardsPanel} aria-label="Rewards and benefits status">
      <div className={styles.sectionHeader}>
        <span className={styles.eyebrow}>Rewards and benefits</span>
        <h2>Not live from Plaid</h2>
      </div>
      <p>
        Tally is not detecting points, miles, cashback balances, reward multipliers, or unused issuer benefits in this MVP.
      </p>
      <div className={styles.twoColumnList}>
        <div>
          <h3>Supported now</h3>
          <ul>
            {capability.supportedNow.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
        <div>
          <h3>Deferred</h3>
          <ul>
            {capability.unsupportedNow.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      </div>
    </section>
  );
}

function EmptyOrBlockedNotice({
  dataError,
  isConfigured,
  isSignedIn
}: Pick<CreditHealthViewProps, "dataError" | "isConfigured" | "isSignedIn">) {
  if (!isConfigured) {
    return <div className={styles.notice}>Supabase is not configured, so persisted credit health data cannot be loaded.</div>;
  }
  if (!isSignedIn) {
    return <div className={styles.notice}>Sign in with Supabase Auth to load and save manual credit score snapshots.</div>;
  }
  if (dataError) {
    return <div className={styles.errorNotice} role="alert">{dataError}</div>;
  }
  return null;
}

export function CreditHealthView({
  asOfDate,
  capability,
  dataError,
  isConfigured,
  isDemo,
  isSignedIn,
  liabilities,
  scoreSnapshots,
  summary
}: CreditHealthViewProps) {
  const blocked = !isConfigured || !isSignedIn || Boolean(dataError);

  return (
    <div className={styles.shell}>
      <section className={styles.safetyBanner}>
        <ShieldCheck size={18} aria-hidden />
        <div>
          <h2>Conservative Credit Health MVP</h2>
          <p>
            The score here is manually entered and source-labeled. Tally is not connected to a live credit bureau score
            provider or a Plaid rewards/benefits feed.
          </p>
        </div>
      </section>

      <EmptyOrBlockedNotice dataError={dataError} isConfigured={isConfigured} isSignedIn={isSignedIn} />

      {blocked ? null : (
        <>
          <ScoreCard asOfDate={asOfDate} isDemo={isDemo} snapshots={scoreSnapshots} summary={summary} />
          <UtilizationCard liabilities={liabilities} />
          <GuidanceList summary={summary} />
          <RewardsStatus capability={capability} />
        </>
      )}
    </div>
  );
}
