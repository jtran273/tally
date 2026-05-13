import type { WeeklyPlanningContext } from "@/lib/agents";
import type {
  AgentProposalStatus,
  AgentProposalType,
  AgentTargetKind,
  Json
} from "@/lib/db";

export const OPENCLAW_SIGNAL_CONTRACT_VERSION = "2026-05-13" as const;

export interface OpenClawSignalSafety {
  excludedFields: readonly string[];
  rawProviderPayloadIncluded: false;
  secretsIncluded: false;
  userScoped: true;
  writesAllowed: false;
}

export interface OpenClawProposalSignal {
  id: string;
  clarificationQuestion: string | null;
  confidence: number | null;
  createdAt: string;
  evidence: Json;
  expiresAt: string | null;
  proposalType: AgentProposalType;
  proposedPatch: Json;
  questionFingerprint: string | null;
  sourceAgent: string;
  status: AgentProposalStatus;
  targetId: string;
  targetKind: AgentTargetKind;
  updatedAt: string;
}

export interface OpenClawClarificationQuestion {
  confidence: number | null;
  createdAt: string;
  evidence: Json;
  expiresAt: string | null;
  proposalId: string;
  proposedPatch: Json;
  question: string;
  questionFingerprint: string | null;
  targetId: string;
  targetKind: AgentTargetKind;
}

export interface OpenClawCalendarContext {
  action: "read.upcoming_calendar_context";
  events: [];
  generatedAt: string;
  status: "not_configured";
  window: {
    fromDate: string;
    toDate: string;
  };
}

export interface OpenClawSignalsResponse {
  object: "ledger.openclaw.signals";
  calendarContext: OpenClawCalendarContext;
  contractVersion: typeof OPENCLAW_SIGNAL_CONTRACT_VERSION;
  generatedAt: string;
  nextCursor: string;
  openClarificationQuestions: OpenClawClarificationQuestion[];
  pendingProposals: OpenClawProposalSignal[];
  safety: OpenClawSignalSafety;
  since: string;
  weeklyPlanningContext: WeeklyPlanningContext;
}

export interface OpenClawReplyRequest {
  proposal_id: string;
  raw_text: string;
}

export interface OpenClawReplyResponse {
  answer_kind: string | null;
  applied_patch?: Json;
  proposal_id: string;
  status: AgentProposalStatus;
}
