import type {
  AgentProposalRecord,
  AgentProposalStatus,
  Json
} from "@/lib/db";
import { normalizeReimbursementClarificationAnswer } from "./clarifications";
import { assertAssistantContextSafe } from "./assistant-contract";

export type AgentProposalJsonObject = Record<string, Json | undefined>;

export interface NormalizedAgentClarificationAnswer {
  answerKind: ReturnType<typeof normalizeReimbursementClarificationAnswer>["kind"];
  counterparties: string[];
  rawAnswer: string;
}

export function isJsonObject(value: Json): value is AgentProposalJsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function assertAgentProposalPayloadSafe(evidence: Json, proposedPatch: Json): void {
  if (!isJsonObject(evidence)) {
    throw new Error("Agent proposal evidence must be a JSON object.");
  }
  if (!isJsonObject(proposedPatch)) {
    throw new Error("Agent proposal patch must be a JSON object.");
  }

  assertAssistantContextSafe(evidence);
  assertAssistantContextSafe(proposedPatch);
}

export function isAgentProposalExpired(
  proposal: Pick<AgentProposalRecord, "expiresAt" | "status">,
  now = new Date()
) {
  return proposal.status === "pending" &&
    Boolean(proposal.expiresAt) &&
    Date.parse(proposal.expiresAt ?? "") <= now.getTime();
}

export function isVisibleAgentProposal(
  proposal: Pick<AgentProposalRecord, "expiresAt" | "status">,
  options: { includeExpired?: boolean; now?: Date } = {}
) {
  return options.includeExpired === true || !isAgentProposalExpired(proposal, options.now);
}

export function canDismissAgentProposal(status: AgentProposalStatus) {
  return status === "pending" || status === "expired" || status === "dismissed";
}

export function normalizeAgentClarificationAnswer(answer: string): NormalizedAgentClarificationAnswer {
  const normalized = normalizeReimbursementClarificationAnswer(answer);
  return {
    answerKind: normalized.kind,
    counterparties: normalized.counterparties,
    rawAnswer: normalized.rawAnswer
  };
}

export type MonthlyBudgetProposalReplyKind = "approve" | "adjust" | "other";

export interface NormalizedMonthlyBudgetProposalReply {
  answerKind: MonthlyBudgetProposalReplyKind;
  rawAnswer: string;
}

export function normalizeMonthlyBudgetProposalReply(answer: string): NormalizedMonthlyBudgetProposalReply {
  const rawAnswer = answer.trim().replace(/\s+/g, " ");
  const normalized = rawAnswer.toLowerCase();
  if (/^(approve|approved|accept|accepted|confirm|confirmed|yes|ok|okay|lgtm|looks good)[.!]*$/.test(normalized)) {
    return { answerKind: "approve", rawAnswer };
  }
  if (/[a-z].*\$?\d/.test(normalized)) {
    return { answerKind: "adjust", rawAnswer };
  }
  return { answerKind: "other", rawAnswer };
}
