import { type NextRequest } from "next/server";
import {
  createMonthlyBudgetProposalServiceContext,
  MonthlyBudgetProposalConfigurationError,
  persistMonthlyBudgetProposal,
  resolveMonthlyBudgetProposalEnabled
} from "@/lib/agents/monthly-budget-proposals";
import { logSafeError } from "@/lib/security/logging";
import { isAuthorizedBearerToken, jsonNoStore } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function isAuthorizedMonthlyBudgetProposalScheduleRequest(headers: Headers) {
  return isAuthorizedBearerToken(headers, process.env.CRON_SECRET);
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedMonthlyBudgetProposalScheduleRequest(request.headers)) {
    return jsonNoStore({ error: "Scheduled monthly budget proposal run is not authorized." }, { status: 401 });
  }

  if (!resolveMonthlyBudgetProposalEnabled()) {
    return jsonNoStore({ run: { proposal: null, status: "disabled" } });
  }

  try {
    const { client, userId } = createMonthlyBudgetProposalServiceContext();
    const result = await persistMonthlyBudgetProposal(client, userId);

    if (!result) {
      return jsonNoStore({ run: { proposal: null, status: "skipped" } });
    }

    return jsonNoStore({
      run: {
        proposal: {
          categoryCount: result.plan.categories.length,
          id: result.proposal.id,
          month: result.plan.month,
          status: result.proposal.status,
          totalAmount: result.plan.totalAmount
        },
        status: "completed"
      }
    });
  } catch (error) {
    if (error instanceof MonthlyBudgetProposalConfigurationError) {
      return jsonNoStore({ error: "Monthly budget proposal run is not configured." }, { status: 503 });
    }

    logSafeError("monthly_budget_proposal_scheduled_failed", error);
    return jsonNoStore({ error: "Unable to run monthly budget proposal." }, { status: 500 });
  }
}
