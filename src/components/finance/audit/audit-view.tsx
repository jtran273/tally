import { History, ShieldCheck } from "lucide-react";
import {
  actionGroupLabel,
  allActionGroups,
  countByGroup,
  formatAuditEvent,
  type AuditActionGroup,
  type DisplayAuditEvent
} from "@/lib/audit/format";
import type { AuditEventRow } from "@/lib/db";
import styles from "./audit.module.css";

interface AuditViewProps {
  events: AuditEventRow[];
  dataError?: string;
  isConfigured: boolean;
  isSignedIn: boolean;
  appliedFilters: {
    group: AuditActionGroup | "all";
    fromDate?: string;
    toDate?: string;
    searchText?: string;
  };
  nextCursor?: string;
  hasActiveCursor?: boolean;
}

function buildPagerHref(
  filters: AuditViewProps["appliedFilters"],
  options: { before?: string } = {}
): string {
  const params = new URLSearchParams();
  if (filters.group !== "all") params.set("group", filters.group);
  if (filters.fromDate) params.set("from", filters.fromDate);
  if (filters.toDate) params.set("to", filters.toDate);
  if (filters.searchText) params.set("q", filters.searchText);
  if (options.before) params.set("before", options.before);
  const serialized = params.toString();
  return serialized ? `/audit?${serialized}` : "/audit";
}

const ENTITY_FILTERS: Array<{ value: string; label: string }> = [
  { value: "review", label: "Review" },
  { value: "merchant-rule", label: "Merchant rule" },
  { value: "agent-proposal", label: "Agent proposal" },
  { value: "recurring", label: "Recurring" },
  { value: "reimbursement", label: "Reimbursement" },
  { value: "plaid", label: "Plaid" },
  { value: "seed-demo", label: "Seed/demo" }
];

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  year: "numeric"
});

function formatOccurredAt(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return dateTimeFormatter.format(parsed);
}

function ChangeColumn({ heading, entries }: { heading: string; entries: DisplayAuditEvent["after"] }) {
  if (entries.length === 0) return null;
  return (
    <div className={styles.changeColumn}>
      <header>{heading}</header>
      <dl>
        {entries.map((entry) => (
          <div key={entry.key} style={{ display: "contents" }}>
            <dt>{entry.key}</dt>
            <dd>{entry.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function EventRow({ event }: { event: DisplayAuditEvent }) {
  return (
    <article className={styles.row}>
      <div className={styles.rowMeta}>
        <span className={styles.groupChip}>{event.groupLabel}</span>
        <strong>{formatOccurredAt(event.occurredAt)}</strong>
        <span>{event.action}</span>
      </div>
      <div className={styles.rowMain}>
        <h3>{event.actionLabel}</h3>
        <div className={styles.rowEntity}>
          <span>{event.entityLabel}</span>
          <span>id {event.entityIdShort}</span>
        </div>
        {(event.before.length > 0 || event.after.length > 0) && (
          <div className={styles.rowChanges}>
            <ChangeColumn heading="Before" entries={event.before} />
            <ChangeColumn heading="After" entries={event.after} />
          </div>
        )}
        {event.metadata.length > 0 && (
          <div className={styles.rowChanges}>
            <ChangeColumn heading="Metadata" entries={event.metadata} />
          </div>
        )}
      </div>
      <div className={styles.actorRow}>
        <span>Actor</span>
        <strong>{event.actorIdShort}</strong>
      </div>
    </article>
  );
}

export function AuditView({
  events,
  dataError,
  isConfigured,
  isSignedIn,
  appliedFilters,
  nextCursor,
  hasActiveCursor
}: AuditViewProps) {
  const canShow = isConfigured && isSignedIn && !dataError;
  const display = events.map(formatAuditEvent);
  const counts = countByGroup(events);
  const groups = allActionGroups();

  return (
    <div className={styles.shell}>
      <section className={styles.summaryGrid} aria-label="Audit summary">
        <div className={styles.summaryTile}>
          <span>
            <History size={13} aria-hidden />
            Events
          </span>
          <strong>{events.length.toLocaleString("en-US")}</strong>
        </div>
        {groups
          .filter((group) => counts[group] > 0)
          .slice(0, 4)
          .map((group) => (
            <div key={group} className={styles.summaryTile}>
              <span>{actionGroupLabel(group)}</span>
              <strong>{counts[group].toLocaleString("en-US")}</strong>
            </div>
          ))}
      </section>

      <section className={styles.safetyPanel} aria-label="Audit safety">
        <ShieldCheck size={17} aria-hidden />
        <div>
          <h2>Audit history is sanitized</h2>
          <p>
            Rows show action, entity label, redacted before and after values, and a shortened actor identifier. Raw Plaid
            payloads, secrets, tokens, authorization headers, and provider identifiers are never rendered.
          </p>
        </div>
      </section>

      <form className={styles.filters} method="get" action="/audit" aria-label="Audit filters">
        <label className={styles.filterField}>
          Group
          <select name="group" defaultValue={appliedFilters.group}>
            <option value="all">All</option>
            {ENTITY_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.filterField}>
          From
          <input type="date" name="from" defaultValue={appliedFilters.fromDate ?? ""} />
        </label>
        <label className={styles.filterField}>
          To
          <input type="date" name="to" defaultValue={appliedFilters.toDate ?? ""} />
        </label>
        <label className={styles.filterField}>
          Search
          <input
            type="search"
            name="q"
            defaultValue={appliedFilters.searchText ?? ""}
            placeholder="action, entity, or id"
            maxLength={80}
          />
        </label>
        <div className={styles.filterActions}>
          <button className={styles.applyButton} type="submit">Apply filters</button>
          <a className={styles.resetLink} href="/audit">Reset</a>
        </div>
      </form>

      {!isConfigured ? (
        <div className={styles.notice} role="status">
          Supabase is not configured for this environment, so audit history cannot be loaded.
        </div>
      ) : null}

      {isConfigured && !isSignedIn ? (
        <div className={styles.notice} role="status">
          Sign in with Supabase Auth to load audit history.
        </div>
      ) : null}

      {dataError ? (
        <div className={styles.errorNotice} role="alert">
          {dataError}
        </div>
      ) : null}

      {!canShow ? null : events.length === 0 ? (
        <div className={styles.emptyState}>
          <History size={26} aria-hidden />
          <h2>No audit events match these filters</h2>
          <p>Material changes appear here within seconds of being written by the app.</p>
        </div>
      ) : (
        <>
          <div className={styles.list}>
            {display.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
          <nav className={styles.pager} aria-label="Audit pagination">
            {hasActiveCursor ? (
              <a className={styles.pagerLink} href={buildPagerHref(appliedFilters)}>← Newest</a>
            ) : <span />}
            {nextCursor ? (
              <a className={styles.pagerLink} href={buildPagerHref(appliedFilters, { before: nextCursor })}>
                Older →
              </a>
            ) : <span />}
          </nav>
        </>
      )}
    </div>
  );
}
