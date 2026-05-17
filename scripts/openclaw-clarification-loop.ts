#!/usr/bin/env tsx
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  createOpenClawHttpClient,
  emptyOpenClawClarificationState,
  runOpenClawClarificationLoop,
  type OpenClawClarificationLoopState
} from "../src/lib/openclaw/live-clarification-loop";

const DEFAULT_STATE_PATH = ".openclaw/clarification-loop-state.json";

function env(name: string) {
  return process.env[name]?.trim() || null;
}

function envFlag(name: string) {
  const value = env(name)?.toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

async function loadState(path: string): Promise<OpenClawClarificationLoopState> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as OpenClawClarificationLoopState;
    return {
      asked: Array.isArray(parsed.asked) ? parsed.asked : [],
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

async function promptForAnswer(message: string) {
  const rl = createInterface({ input, output });
  try {
    console.log(message);
    const answer = await rl.question("Answer (leave blank to skip posting a reply): ");
    return answer.trim() || null;
  } finally {
    rl.close();
  }
}

async function main() {
  const baseUrl = env("OPENCLAW_TALLY_BASE_URL") ?? env("TALLY_BASE_URL");
  const token = env("OPENCLAW_TOKEN");
  if (!baseUrl || !token) {
    throw new Error("Set OPENCLAW_TALLY_BASE_URL (or TALLY_BASE_URL) and OPENCLAW_TOKEN before running the loop.");
  }

  const statePath = env("OPENCLAW_CLARIFICATION_STATE_PATH") ?? DEFAULT_STATE_PATH;
  const state = await loadState(statePath);
  const answerOverride = env("OPENCLAW_CLARIFICATION_ANSWER");
  const noninteractive = envFlag("OPENCLAW_CLARIFICATION_NONINTERACTIVE");

  const result = await runOpenClawClarificationLoop({
    client: createOpenClawHttpClient({ baseUrl, token }),
    messenger: {
      async ask(_question, message) {
        if (noninteractive && !answerOverride) return null;
        return answerOverride ?? promptForAnswer(message);
      }
    },
    state
  }).finally(async () => {
    await saveState(statePath, state);
  });

  console.log(JSON.stringify({
    askedQuestion: result.askedQuestion,
    nextCursor: result.nextCursor,
    proposalId: result.proposalId,
    status: result.status
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
