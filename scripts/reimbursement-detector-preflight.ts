#!/usr/bin/env tsx
import { getOpenAiSuggestionModel, isOpenAiSuggestionConfigured } from "../src/lib/ai/openai-provider";
import { isOpenAiAutoReviewEnabled } from "../src/lib/ai/server";
import {
  resolveProactiveScanEnabled,
  resolveProactiveScanMaxTransactions,
  resolveProactiveScanUserId
} from "../src/lib/agents/proactive-scan";

// Read-only config preflight for issue #111 (operationalize the LLM
// reimbursement candidate detector). It reports the *effective* detector
// configuration using the same resolvers the runtime uses, so what you see
// here is what the scheduled scan will actually do.
//
// It never prints secret VALUES — only whether each secret is set. Safe to run
// anywhere, but it reads server-only env, so run it where those vars are loaded.

interface Line {
  label: string;
  value: string;
  warn?: boolean;
}

function present(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function main() {
  const autoReviewEnabled = isOpenAiAutoReviewEnabled();
  const openAiConfigured = isOpenAiSuggestionConfigured();
  const model = openAiConfigured ? getOpenAiSuggestionModel() : null;
  const scanEnabled = resolveProactiveScanEnabled();
  const maxTransactions = resolveProactiveScanMaxTransactions();
  const scanUserId = resolveProactiveScanUserId();
  const serviceRoleSet = present("SUPABASE_SERVICE_ROLE_KEY");
  const cronSecretSet = present("CRON_SECRET");

  const lines: Line[] = [
    { label: "ENABLE_OPENAI_AUTO_REVIEW", value: autoReviewEnabled ? "true (auto-review on)" : "false (auto-review off)", warn: !autoReviewEnabled },
    { label: "OpenAI provider configured (OPENAI_API_KEY)", value: openAiConfigured ? "yes" : "no", warn: !openAiConfigured },
    { label: "OPENAI_MODEL (effective)", value: model ?? "n/a (provider not configured)", warn: !model },
    { label: "PROACTIVE_SCAN_ENABLED", value: scanEnabled ? "true" : "false", warn: !scanEnabled },
    { label: "PROACTIVE_SCAN_MAX_TX (effective cap)", value: String(maxTransactions) },
    { label: "Scan user id (PROACTIVE_SCAN_USER_ID / OPENCLAW_USER_ID)", value: scanUserId ? "set" : "MISSING", warn: !scanUserId },
    { label: "SUPABASE_SERVICE_ROLE_KEY", value: serviceRoleSet ? "set" : "MISSING", warn: !serviceRoleSet },
    { label: "CRON_SECRET (guards scheduled route)", value: cronSecretSet ? "set" : "MISSING", warn: !cronSecretSet }
  ];

  console.log("LLM reimbursement detector preflight (issue #111)\n");
  for (const line of lines) {
    console.log(`${line.warn ? "WARN" : "ok  "}  ${line.label}: ${line.value}`);
  }

  console.log("");
  const blocking: string[] = [];
  if (!openAiConfigured) blocking.push("OPENAI_API_KEY");
  if (!scanUserId) blocking.push("PROACTIVE_SCAN_USER_ID or OPENCLAW_USER_ID");
  if (!serviceRoleSet) blocking.push("SUPABASE_SERVICE_ROLE_KEY");

  if (blocking.length > 0) {
    console.log(`The scheduled scan cannot run a real OpenAI pass until these are set: ${blocking.join(", ")}.`);
    console.log("See docs/runbooks/operationalize-llm-reimbursement-detector.md for the full activation steps.");
    process.exit(1);
  }

  if (!autoReviewEnabled || !scanEnabled) {
    console.log("Credentials look complete, but the detector is currently disabled by flags.");
    console.log("This is the safe default. Enable ENABLE_OPENAI_AUTO_REVIEW and PROACTIVE_SCAN_ENABLED when you are ready.");
    return;
  }

  console.log("Detector is fully configured and enabled. Review proposal volume/quality per the runbook.");
}

main();
