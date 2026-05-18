import { CheckCircle2, Sparkles, TriangleAlert, Wrench } from "lucide-react";
import type { AiSuggestionQualitySummary } from "@/lib/review/quality";
import styles from "./ai-quality-panel.module.css";

interface AiQualityPanelProps {
  summary: AiSuggestionQualitySummary;
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function AiQualityPanel({ summary }: AiQualityPanelProps) {
  const hasHistory = summary.totalReviewedWithSuggestion > 0;

  return (
    <section className={styles.panel} aria-label="AI suggestion quality">
      <header className={styles.header}>
        <span className={styles.eyebrow}>
          <Sparkles size={13} aria-hidden /> AI quality
        </span>
        <h2>How AI suggestions land</h2>
        <p>
          Counts only review items that had an AI suggestion. Open items are not yet decided.
          {hasHistory ? null : " Resolve a few reviews to populate trends."}
        </p>
      </header>

      <div className={styles.tileGrid}>
        <div className={styles.tile}>
          <span>Acceptance rate</span>
          <strong>{hasHistory ? percent(summary.acceptanceRate) : "—"}</strong>
          <span className={styles.subMuted}>{summary.acceptedCount} accepted of {summary.totalReviewedWithSuggestion}</span>
        </div>
        <div className={styles.tile}>
          <span>
            <CheckCircle2 size={11} aria-hidden /> Accepted
          </span>
          <strong className={styles.pos}>{summary.acceptedCount}</strong>
        </div>
        <div className={styles.tile}>
          <span>
            <Wrench size={11} aria-hidden /> Edited
          </span>
          <strong>{summary.editedCount}</strong>
        </div>
        <div className={styles.tile}>
          <span>
            <TriangleAlert size={11} aria-hidden /> Dismissed
          </span>
          <strong className={summary.dismissedCount > 0 ? styles.warn : undefined}>{summary.dismissedCount}</strong>
        </div>
        <div className={styles.tile}>
          <span>Reviews avoided</span>
          <strong className={styles.pos}>{summary.estimatedReviewsAvoided}</strong>
          <span className={styles.subMuted}>via {summary.aiDerivedRuleCount} merchant rule{summary.aiDerivedRuleCount === 1 ? "" : "s"}</span>
        </div>
        <div className={styles.tile}>
          <span>Open with suggestion</span>
          <strong>{summary.openCount}</strong>
        </div>
      </div>

      {hasHistory ? (
        <div className={styles.breakdown}>
          <div>
            <h3>Top reasons</h3>
            <ul>
              {summary.byReason.map((row) => (
                <li key={row.label}>
                  <span>{row.label}</span>
                  <span className={styles.subMuted}>
                    {row.accepted} acc · {row.edited} ed · {row.dismissed} dis
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3>Top categories</h3>
            <ul>
              {summary.byCategory.map((row) => (
                <li key={row.label}>
                  <span>{row.label}</span>
                  <span className={styles.subMuted}>{row.total} reviewed</span>
                </li>
              ))}
              {summary.byCategory.length === 0 ? <li className={styles.subMuted}>No category data yet.</li> : null}
            </ul>
          </div>
          <div>
            <h3>Top merchants</h3>
            <ul>
              {summary.byMerchant.map((row) => (
                <li key={row.label}>
                  <span>{row.label}</span>
                  <span className={styles.subMuted}>{row.total} reviewed</span>
                </li>
              ))}
              {summary.byMerchant.length === 0 ? <li className={styles.subMuted}>No merchant data yet.</li> : null}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}
