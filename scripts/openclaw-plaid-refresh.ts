#!/usr/bin/env tsx
// Calls Tally's bounded OpenClaw Plaid refresh endpoint and prints only the
// sanitized status packet returned by the app.

const DEFAULT_TIMEOUT_MS = 60_000;

function argValue(name: string) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function timeoutMs() {
  const parsed = Number(argValue("timeout-ms") ?? process.env.OPENCLAW_TALLY_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

async function main() {
  const baseUrl = requiredEnv("OPENCLAW_TALLY_BASE_URL").replace(/\/+$/, "");
  const token = requiredEnv("OPENCLAW_PLAID_REFRESH_TOKEN");
  const timeout = timeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const startedAt = Date.now();

  const response = await fetch(new URL("/api/openclaw/plaid-refresh", baseUrl), {
    headers: { authorization: `Bearer ${token}` },
    method: "POST",
    signal: controller.signal
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Tally Plaid refresh timed out after ${timeout}ms.`);
    }
    throw error;
  });

  clearTimeout(timer);

  const body = await response.json().catch(() => null) as {
    error?: unknown;
    object?: unknown;
    reason?: unknown;
    status?: unknown;
    sync?: {
      accountsUpserted?: unknown;
      balanceSnapshotsUpserted?: unknown;
      enrichedTransactionsInserted?: unknown;
      enrichedTransactionsUpdated?: unknown;
      errorSummary?: unknown;
      failed?: unknown;
      pendingTransactionsReplaced?: unknown;
      rawTransactionsSkipped?: unknown;
      rawTransactionsUpserted?: unknown;
      status?: unknown;
      succeeded?: unknown;
      totalItems?: unknown;
      transactionsRemoved?: unknown;
    };
  } | null;

  console.log(JSON.stringify({
    elapsedMs: Date.now() - startedAt,
    error: typeof body?.error === "string" ? body.error : null,
    httpStatus: response.status,
    object: typeof body?.object === "string" ? body.object : null,
    reason: typeof body?.reason === "string" ? body.reason : null,
    status: typeof body?.status === "string" ? body.status : null,
    sync: body?.sync
      ? {
          accountsUpserted: body.sync.accountsUpserted ?? null,
          balanceSnapshotsUpserted: body.sync.balanceSnapshotsUpserted ?? null,
          enrichedTransactionsInserted: body.sync.enrichedTransactionsInserted ?? null,
          enrichedTransactionsUpdated: body.sync.enrichedTransactionsUpdated ?? null,
          errorSummary: Array.isArray(body.sync.errorSummary) ? body.sync.errorSummary : [],
          failed: body.sync.failed ?? null,
          pendingTransactionsReplaced: body.sync.pendingTransactionsReplaced ?? null,
          rawTransactionsSkipped: body.sync.rawTransactionsSkipped ?? null,
          rawTransactionsUpserted: body.sync.rawTransactionsUpserted ?? null,
          status: body.sync.status ?? null,
          succeeded: body.sync.succeeded ?? null,
          totalItems: body.sync.totalItems ?? null,
          transactionsRemoved: body.sync.transactionsRemoved ?? null
        }
      : null
  }, null, 2));

  if (!response.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
