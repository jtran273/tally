#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
  createOpenClawHttpClient,
  emptyOpenClawClarificationState,
  markOpenClawClarificationAnswered,
  selectOpenClawClarificationReplyTarget,
  type OpenClawClarificationLoopState
} from "../src/lib/openclaw/live-clarification-loop";

const DEFAULT_STATE_PATH = ".openclaw/clarification-loop-state.json";

function env(name: string) {
  return process.env[name]?.trim() || null;
}

async function loadState(path: string): Promise<OpenClawClarificationLoopState> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as OpenClawClarificationLoopState;
    return {
      asked: Array.isArray(parsed.asked)
        ? parsed.asked.map((entry) => ({
          answeredAt: typeof entry.answeredAt === "string" ? entry.answeredAt : null,
          askedAt: typeof entry.askedAt === "string" ? entry.askedAt : "",
          proposalId: typeof entry.proposalId === "string" ? entry.proposalId : "",
          questionFingerprint: typeof entry.questionFingerprint === "string" ? entry.questionFingerprint : null
        })).filter((entry) => entry.proposalId && entry.askedAt)
        : [],
      nextCursor: typeof parsed.nextCursor === "string" ? parsed.nextCursor : null
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return emptyOpenClawClarificationState();
    }
    throw error;
  }
}

async function saveState(path: string, state: OpenClawClarificationLoopState) {
  await mkdir(path.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`);
}

function answerFromArgs() {
  return process.argv.slice(2).join(" ").trim() || null;
}

async function main() {
  const baseUrl = env("OPENCLAW_TALLY_BASE_URL") ?? env("TALLY_BASE_URL");
  const token = env("OPENCLAW_TOKEN");
  if (!baseUrl || !token) {
    throw new Error("Set OPENCLAW_TALLY_BASE_URL (or TALLY_BASE_URL) and OPENCLAW_TOKEN before posting a reply.");
  }

  const answer = env("OPENCLAW_CLARIFICATION_ANSWER") ?? answerFromArgs();
  if (!answer) {
    throw new Error("Set OPENCLAW_CLARIFICATION_ANSWER or pass the answer as CLI arguments.");
  }

  const statePath = env("OPENCLAW_CLARIFICATION_STATE_PATH") ?? DEFAULT_STATE_PATH;
  const proposalId = env("OPENCLAW_CLARIFICATION_PROPOSAL_ID");
  const state = await loadState(statePath);
  const target = selectOpenClawClarificationReplyTarget(state, proposalId);

  if (!target) {
    throw new Error(proposalId
      ? `No asked clarification found in state for proposal ${proposalId}.`
      : "No unanswered clarification proposal found in state.");
  }
  if (target.answeredAt) {
    throw new Error(`Clarification proposal ${target.proposalId} was already marked answered at ${target.answeredAt}.`);
  }

  const reply = await createOpenClawHttpClient({ baseUrl, token }).postReply(target.proposalId, answer);
  markOpenClawClarificationAnswered(state, target.proposalId, new Date().toISOString());
  await saveState(statePath, state);

  console.log(JSON.stringify({
    answerKind: reply.answer_kind,
    proposalId: target.proposalId,
    status: reply.status
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
