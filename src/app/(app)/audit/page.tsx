import { AuditView } from "@/components/finance/audit/audit-view";
import { allActionGroups, type AuditActionGroup } from "@/lib/audit/format";
import { listAuditEvents, type AuditEventListFilters, type AuditEventRow } from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

const GROUP_TO_ACTION_PREFIX: Record<AuditActionGroup, string | null> = {
  review: "review.",
  "merchant-rule": "merchant_rule.",
  "agent-proposal": "agent_proposal.",
  recurring: "recurring.",
  reimbursement: "reimbursement.",
  plaid: "plaid.",
  "seed-demo": null,
  other: null
};

const GROUP_TO_ENTITY_TABLE: Partial<Record<AuditActionGroup, string>> = {
  "seed-demo": "seed"
};

function parseGroup(value: string | string[] | undefined): AuditActionGroup | "all" {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || raw === "all") return "all";
  return (allActionGroups() as string[]).includes(raw) ? (raw as AuditActionGroup) : "all";
}

function parseDate(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const match = /^\d{4}-\d{2}-\d{2}$/.exec(raw);
  return match ? raw : undefined;
}

function parseIsoTimestamp(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function parseSearchText(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 || trimmed.length > 80 ? undefined : trimmed;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load audit history.";
}

interface AuditPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
  const params = (await searchParams) ?? {};
  const group = parseGroup(params.group);
  const fromDate = parseDate(params.from);
  const toDate = parseDate(params.to);
  const before = parseIsoTimestamp(params.before);
  const searchText = parseSearchText(params.q);

  const context = await getFinanceServerContext();
  let dataError = context.dataError;
  let events: AuditEventRow[] = [];
  let hasMore = false;
  let nextCursor: string | undefined;

  if (context.client && context.userId) {
    const filters: AuditEventListFilters = { limit: PAGE_SIZE + 1 };
    if (group !== "all") {
      const prefix = GROUP_TO_ACTION_PREFIX[group];
      const entityTable = GROUP_TO_ENTITY_TABLE[group];
      if (prefix) filters.actionPrefix = prefix;
      if (entityTable) filters.entityTable = entityTable;
    }
    if (fromDate) filters.fromDate = `${fromDate}T00:00:00.000Z`;
    if (toDate) filters.toDate = `${toDate}T23:59:59.999Z`;
    if (before) filters.before = before;
    if (searchText) filters.searchText = searchText;

    try {
      const rows = await listAuditEvents(context.client, context.userId, filters);
      hasMore = rows.length > PAGE_SIZE;
      events = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
      if (hasMore && events.length > 0) {
        nextCursor = events[events.length - 1].created_at;
      }
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  return (
    <AuditView
      events={events}
      dataError={dataError}
      isConfigured={context.isConfigured}
      isSignedIn={context.isSignedIn}
      appliedFilters={{ group, fromDate, toDate, searchText }}
      nextCursor={hasMore ? nextCursor : undefined}
      hasActiveCursor={Boolean(before)}
    />
  );
}
