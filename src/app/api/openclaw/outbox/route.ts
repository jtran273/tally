import { type NextRequest } from "next/server";
import {
  createOpenClawServiceContext,
  OpenClawRouteConfigurationError,
  requireOpenClawAuth
} from "@/lib/openclaw/route-helpers";
import { buildOpenClawOutboxResponse } from "@/lib/openclaw/outbox";
import {
  loadOpenClawSignals,
  OpenClawSignalsBadRequestError,
  resolveOpenClawSince
} from "@/lib/openclaw/signals";
import { logSafeError } from "@/lib/security/logging";
import { jsonNoStore } from "@/lib/security/request";
import type { OpenClawOutboxMinimumPriority } from "@/lib/openclaw/outbox";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseMessageLimit(value: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 25) {
    throw new OpenClawSignalsBadRequestError("limit must be an integer from 0 to 25.");
  }
  return parsed;
}

function parseIncludeBudget(value: string | null) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes"].includes(normalized)) return true;
  if (["0", "false", "no"].includes(normalized)) return false;
  throw new OpenClawSignalsBadRequestError("include_budget must be true or false.");
}

function parseMinPriority(value: string | null): OpenClawOutboxMinimumPriority | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "normal" || normalized === "high") return normalized;
  throw new OpenClawSignalsBadRequestError("min_priority must be normal or high.");
}

export async function GET(request: NextRequest) {
  const unauthorized = requireOpenClawAuth(request);
  if (unauthorized) return unauthorized;

  let since: string;
  let messageLimit: number | undefined;
  let includeBudgetBriefing: boolean | undefined;
  let minPriority: OpenClawOutboxMinimumPriority | undefined;
  try {
    since = resolveOpenClawSince(request.nextUrl.searchParams.get("since"));
    messageLimit = parseMessageLimit(request.nextUrl.searchParams.get("limit"));
    includeBudgetBriefing = parseIncludeBudget(request.nextUrl.searchParams.get("include_budget"));
    minPriority = parseMinPriority(request.nextUrl.searchParams.get("min_priority"));
  } catch (error) {
    if (error instanceof OpenClawSignalsBadRequestError) {
      return jsonNoStore({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  try {
    const { client, userId } = createOpenClawServiceContext();
    const signals = await loadOpenClawSignals(client, userId, { since });
    return jsonNoStore(buildOpenClawOutboxResponse(signals, { includeBudgetBriefing, messageLimit, minPriority }));
  } catch (error) {
    if (error instanceof OpenClawRouteConfigurationError) {
      return jsonNoStore({ error: "OpenClaw integration is not configured." }, { status: 503 });
    }

    logSafeError("openclaw_outbox_failed", error);
    return jsonNoStore({ error: "Unable to load OpenClaw outbox." }, { status: 500 });
  }
}
