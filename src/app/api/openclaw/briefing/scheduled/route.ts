import { type NextRequest } from "next/server";
import { persistOpenClawBriefing, resolveOpenClawBriefingCadence } from "@/lib/agents/openclaw-briefing";
import {
  createOpenClawServiceContext,
  OpenClawRouteConfigurationError
} from "@/lib/openclaw/route-helpers";
import { logSafeError } from "@/lib/security/logging";
import { isAuthorizedBearerToken, jsonNoStore } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function isAuthorizedOpenClawBriefingScheduleRequest(headers: Headers) {
  return isAuthorizedBearerToken(headers, process.env.CRON_SECRET);
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedOpenClawBriefingScheduleRequest(request.headers)) {
    return jsonNoStore({ error: "Scheduled OpenClaw briefing is not authorized." }, { status: 401 });
  }

  let cadence;
  try {
    cadence = resolveOpenClawBriefingCadence();
  } catch (error) {
    return jsonNoStore(
      { error: error instanceof Error ? error.message : "Invalid OpenClaw briefing cadence." },
      { status: 503 }
    );
  }

  try {
    const { client, userId } = createOpenClawServiceContext();
    const result = await persistOpenClawBriefing(client, userId, { cadence });

    return jsonNoStore({
      briefing: {
        asOfDate: result.briefing.asOfDate,
        cadence: result.briefing.cadence,
        calendarPressure: result.briefing.calendarPressure.level,
        reimbursementCandidateCount: result.briefing.reimbursementCandidates.count,
        suggestedQuestionCount: result.briefing.suggestedQuestions.length,
        window: result.briefing.window
      },
      proposal: {
        id: result.proposal.id,
        sourceContextId: result.proposal.sourceContextId,
        status: result.proposal.status,
        updatedAt: result.proposal.updatedAt
      }
    });
  } catch (error) {
    if (error instanceof OpenClawRouteConfigurationError) {
      return jsonNoStore({ error: "OpenClaw briefing integration is not configured." }, { status: 503 });
    }

    logSafeError("openclaw_briefing_scheduled_failed", error);
    return jsonNoStore({ error: "Unable to compile OpenClaw briefing." }, { status: 500 });
  }
}

export const GET = POST;
