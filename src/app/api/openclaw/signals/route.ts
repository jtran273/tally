import { type NextRequest } from "next/server";
import {
  createOpenClawServiceContext,
  OpenClawRouteConfigurationError,
  requireOpenClawAuth
} from "@/lib/openclaw/route-helpers";
import {
  loadOpenClawSignals,
  OpenClawSignalsBadRequestError,
  resolveOpenClawSince
} from "@/lib/openclaw/signals";
import { jsonNoStore } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const unauthorized = requireOpenClawAuth(request);
  if (unauthorized) return unauthorized;

  let since: string;
  try {
    since = resolveOpenClawSince(request.nextUrl.searchParams.get("since"));
  } catch (error) {
    if (error instanceof OpenClawSignalsBadRequestError) {
      return jsonNoStore({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  try {
    const { client, userId } = createOpenClawServiceContext();
    const signals = await loadOpenClawSignals(client, userId, { since });
    return jsonNoStore(signals);
  } catch (error) {
    if (error instanceof OpenClawRouteConfigurationError) {
      return jsonNoStore({ error: "OpenClaw integration is not configured." }, { status: 503 });
    }

    console.error("openclaw_signals_failed", error);
    return jsonNoStore({ error: "Unable to load OpenClaw signals." }, { status: 500 });
  }
}
