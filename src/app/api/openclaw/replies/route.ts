import { type NextRequest } from "next/server";
import {
  OpenClawReplyBadRequestError,
  OpenClawReplyConflictError,
  OpenClawReplyNotFoundError,
  handleOpenClawReply
} from "@/lib/openclaw/replies";
import {
  createOpenClawServiceContext,
  OpenClawRouteConfigurationError,
  requireOpenClawAuth
} from "@/lib/openclaw/route-helpers";
import { logSafeError } from "@/lib/security/logging";
import { jsonNoStore } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function readJson(request: NextRequest) {
  try {
    return await request.json();
  } catch {
    throw new OpenClawReplyBadRequestError("Request body must be valid JSON.");
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = requireOpenClawAuth(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await readJson(request);
    const { client, userId } = createOpenClawServiceContext();
    const reply = await handleOpenClawReply(client, userId, body);
    return jsonNoStore(reply);
  } catch (error) {
    if (error instanceof OpenClawReplyBadRequestError) {
      return jsonNoStore({ error: error.message }, { status: 400 });
    }
    if (error instanceof OpenClawReplyNotFoundError) {
      return jsonNoStore({ error: error.message }, { status: 404 });
    }
    if (error instanceof OpenClawReplyConflictError) {
      return jsonNoStore({ error: error.message }, { status: 409 });
    }
    if (error instanceof OpenClawRouteConfigurationError) {
      return jsonNoStore({ error: "OpenClaw integration is not configured." }, { status: 503 });
    }

    logSafeError("openclaw_reply_failed", error);
    return jsonNoStore({ error: "Unable to record OpenClaw reply." }, { status: 500 });
  }
}
