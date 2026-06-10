import { assertAssistantContextSafe } from "@/lib/agents";
import {
  FinanceDbError,
  getAgentProposalById,
  recordClarificationAnswer,
  recordMonthlyBudgetProposalReply,
  type FinanceSupabaseClient
} from "@/lib/db";
import type { OpenClawReplyRequest, OpenClawReplyResponse } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OpenClawReplyBadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenClawReplyBadRequestError";
  }
}

export class OpenClawReplyNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenClawReplyNotFoundError";
  }
}

export class OpenClawReplyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenClawReplyConflictError";
  }
}

export function parseOpenClawReplyRequest(value: unknown): OpenClawReplyRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OpenClawReplyBadRequestError("Request body must be a JSON object.");
  }

  const body = value as Record<string, unknown>;
  const proposalId = body.proposal_id;
  const rawText = body.raw_text;
  if (typeof proposalId !== "string" || !proposalId.trim()) {
    throw new OpenClawReplyBadRequestError("proposal_id is required.");
  }
  const trimmedProposalId = proposalId.trim();
  if (!UUID_PATTERN.test(trimmedProposalId)) {
    throw new OpenClawReplyBadRequestError("proposal_id must be a valid UUID.");
  }
  if (typeof rawText !== "string" || !rawText.trim()) {
    throw new OpenClawReplyBadRequestError("raw_text is required.");
  }

  return {
    proposal_id: trimmedProposalId,
    raw_text: rawText.trim()
  };
}

function notFoundFromDbError(error: FinanceDbError) {
  const message = error.message.toLowerCase();
  const details = error.details?.toLowerCase() ?? "";
  return (
    message.includes("was not found") ||
    message.includes("0 rows") ||
    (error.code === "PGRST116" && details.includes("0 rows"))
  );
}

function conflictFromDbError(error: FinanceDbError) {
  const message = error.message.toLowerCase();
  return (
    message.includes("not asking a clarification question") ||
    message.includes("not pending") ||
    message.includes("has expired") ||
    message.includes("can no longer")
  );
}

export async function handleOpenClawReply(
  client: FinanceSupabaseClient,
  userId: string,
  body: unknown
): Promise<OpenClawReplyResponse> {
  const parsed = parseOpenClawReplyRequest(body);
  try {
    assertAssistantContextSafe({ rawText: parsed.raw_text });
  } catch {
    throw new OpenClawReplyBadRequestError("raw_text contains forbidden secret-shaped data.");
  }

  try {
    const proposal = await getAgentProposalById(client, userId, parsed.proposal_id);
    if (!proposal) {
      throw new OpenClawReplyNotFoundError("Proposal was not found.");
    }

    // Monthly budget proposals carry a reply action without a clarification
    // question; their replies are recorded for Tally-owned approval flows
    // instead of running the reimbursement clarification parser.
    const recordReply = proposal.proposalType === "monthly_budget_proposal" && !proposal.clarificationQuestion
      ? recordMonthlyBudgetProposalReply
      : recordClarificationAnswer;
    const answered = await recordReply(
      client,
      userId,
      parsed.proposal_id,
      parsed.raw_text,
      {
        actorId: userId,
        source: "openclaw_replies_api"
      }
    );
    const response: OpenClawReplyResponse = {
      answer_kind: answered.clarificationAnswerKind,
      applied_patch: answered.proposedPatch,
      proposal_id: answered.id,
      status: answered.status
    };

    assertAssistantContextSafe(response);
    return response;
  } catch (error) {
    if (error instanceof FinanceDbError && notFoundFromDbError(error)) {
      throw new OpenClawReplyNotFoundError("Proposal was not found.");
    }
    if (error instanceof FinanceDbError && conflictFromDbError(error)) {
      throw new OpenClawReplyConflictError("Proposal can no longer be answered.");
    }
    throw error;
  }
}
