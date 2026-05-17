import { assertAssistantContextSafe } from "@/lib/agents";
import type {
  OpenClawClarificationQuestion,
  OpenClawReplyResponse,
  OpenClawSignalsResponse
} from "./types";

export interface OpenClawClarificationStateEntry {
  answeredAt: string | null;
  askedAt: string;
  proposalId: string;
  questionFingerprint: string | null;
}

export interface OpenClawClarificationLoopState {
  asked: OpenClawClarificationStateEntry[];
  nextCursor: string | null;
}

export interface OpenClawClarificationClient {
  fetchSignals(since: string | null): Promise<OpenClawSignalsResponse>;
  postReply(proposalId: string, rawText: string): Promise<OpenClawReplyResponse>;
}

export interface OpenClawClarificationMessenger {
  ask(question: OpenClawClarificationQuestion, message: string): Promise<string | null>;
}

export interface OpenClawClarificationLoopResult {
  askedQuestion: string | null;
  nextCursor: string;
  proposalId: string | null;
  reply: OpenClawReplyResponse | null;
  status: "answered" | "asked_without_answer" | "no_question";
}

export interface OpenClawHttpClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  token: string;
}

export const emptyOpenClawClarificationState = (): OpenClawClarificationLoopState => ({
  asked: [],
  nextCursor: null
});

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function truncateQuestion(value: string) {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length <= 220) return normalized;
  return `${normalized.slice(0, 217).trimEnd()}…`;
}

function stateHasAsked(state: OpenClawClarificationLoopState, question: OpenClawClarificationQuestion) {
  return state.asked.some((entry) => {
    if (entry.proposalId === question.proposalId) return true;
    return Boolean(entry.questionFingerprint && question.questionFingerprint === entry.questionFingerprint);
  });
}

function markAsked(
  state: OpenClawClarificationLoopState,
  question: OpenClawClarificationQuestion,
  askedAt: string
) {
  if (stateHasAsked(state, question)) return;
  state.asked.push({
    answeredAt: null,
    askedAt,
    proposalId: question.proposalId,
    questionFingerprint: question.questionFingerprint
  });
}

function markAnswered(
  state: OpenClawClarificationLoopState,
  proposalId: string,
  answeredAt: string
) {
  const entry = state.asked.find((item) => item.proposalId === proposalId);
  if (entry) entry.answeredAt = answeredAt;
}

export function selectOpenClawClarificationToAsk(
  signals: OpenClawSignalsResponse,
  state: OpenClawClarificationLoopState
): OpenClawClarificationQuestion | null {
  return signals.openClarificationQuestions.find((question) => !stateHasAsked(state, question)) ?? null;
}

export function buildOpenClawClarificationMessage(question: OpenClawClarificationQuestion) {
  const payload = {
    proposalId: question.proposalId,
    question: truncateQuestion(question.question),
    targetKind: question.targetKind
  };

  assertAssistantContextSafe(payload);
  return `Tally reimbursement check: ${payload.question} Reply yes/no or a name.`;
}

export function createOpenClawHttpClient({
  baseUrl,
  fetchImpl = fetch,
  token
}: OpenClawHttpClientOptions): OpenClawClarificationClient {
  const root = normalizeBaseUrl(baseUrl);
  const authorization = `Bearer ${token}`;

  async function parseJsonResponse(response: Response, action: string) {
    const body = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const message = isRecord(body) && typeof body.error === "string" ? body.error : `${action} failed`;
      throw new Error(`${action} failed with ${response.status}: ${message}`);
    }
    return body;
  }

  return {
    async fetchSignals(since) {
      const url = new URL(`${root}/api/openclaw/signals`);
      if (since) url.searchParams.set("since", since);

      const response = await fetchImpl(url, {
        headers: { authorization },
        method: "GET"
      });
      const body = await parseJsonResponse(response, "fetch OpenClaw signals") as OpenClawSignalsResponse;
      assertAssistantContextSafe(body);
      return body;
    },
    async postReply(proposalId, rawText) {
      const body = {
        proposal_id: proposalId,
        raw_text: rawText.trim()
      };
      assertAssistantContextSafe(body);

      const response = await fetchImpl(`${root}/api/openclaw/replies`, {
        body: JSON.stringify(body),
        headers: {
          authorization,
          "content-type": "application/json"
        },
        method: "POST"
      });
      const parsed = await parseJsonResponse(response, "post OpenClaw reply") as OpenClawReplyResponse;
      assertAssistantContextSafe(parsed);
      return parsed;
    }
  };
}

export async function runOpenClawClarificationLoop({
  client,
  messenger,
  now = new Date(),
  state
}: {
  client: OpenClawClarificationClient;
  messenger: OpenClawClarificationMessenger;
  now?: Date;
  state: OpenClawClarificationLoopState;
}): Promise<OpenClawClarificationLoopResult> {
  const signals = await client.fetchSignals(state.nextCursor);
  state.nextCursor = signals.nextCursor;

  const question = selectOpenClawClarificationToAsk(signals, state);
  if (!question) {
    return {
      askedQuestion: null,
      nextCursor: signals.nextCursor,
      proposalId: null,
      reply: null,
      status: "no_question"
    };
  }

  const askedAt = now.toISOString();
  const message = buildOpenClawClarificationMessage(question);
  markAsked(state, question, askedAt);

  const rawAnswer = (await messenger.ask(question, message))?.trim() ?? "";
  if (!rawAnswer) {
    return {
      askedQuestion: message,
      nextCursor: signals.nextCursor,
      proposalId: question.proposalId,
      reply: null,
      status: "asked_without_answer"
    };
  }

  const reply = await client.postReply(question.proposalId, rawAnswer);
  markAnswered(state, question.proposalId, now.toISOString());

  return {
    askedQuestion: message,
    nextCursor: signals.nextCursor,
    proposalId: question.proposalId,
    reply,
    status: "answered"
  };
}
