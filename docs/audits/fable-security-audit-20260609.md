# Fable Security Audit - 2026-06-09

## Executive summary

Fable was attempted first in a separate worktree, but the non-interactive Claude Code run remained silent for several minutes and produced no files. Codex completed this audit from the same isolated branch.

The main security posture is good: Plaid and Google Calendar tokens use AES-256-GCM vault helpers, production requires stable token encryption keys, sensitive Plaid/raw transaction columns have explicit PostgREST revokes, OpenClaw routes use bearer-token helpers with no-store responses, and OpenClaw/assistant payload builders run recursive forbidden-field assertions before returning data.

One confirmed product-integrity risk remains: AI review suggestions can be automatically applied to finance records without an explicit user approval action. That conflicts with the repo guardrail that AI output is advisory and should not perform autonomous writes.

## Findings

### Medium: AI suggestions can autonomously write transaction enrichment

Evidence:

- `src/lib/review/auto-cleanup.ts:131` evaluates AI suggestions for auto-apply.
- `src/lib/review/auto-cleanup.ts:142` writes the selected patch with `updateTransactionEnrichment`.
- `src/lib/review/auto-cleanup.ts:143` resolves the review item as `auto_resolved`.
- `src/lib/plaid/service.ts:1942` runs import-time auto-apply planning.
- `src/lib/plaid/service.ts:1993` writes the auto-applied enrichment patch during import.
- `src/lib/review/auto-categorization.ts:17` allows auto-apply at `0.7` confidence for several review reasons.
- `AGENTS.md` says AI output should remain advisory and not perform autonomous writes.

Risk:

An AI or mock-provider suggestion can change merchant/category/intent/recurring/confidence fields without James explicitly approving that specific change. The current filters avoid peer-to-peer, manual intents, pending transactions, unknown categories, and low-confidence suggestions, but the behavior is still an autonomous financial-record mutation.

Recommended fix:

Disable autonomous writes from AI suggestions. Store suggestions and mark them accept-ready, but require a user action through the review queue or agent inbox before calling `updateTransactionEnrichment` or `resolveReviewItem`. If import-time cleanup should stay, restrict it to deterministic merchant-rule or non-AI heuristics and name that path separately from AI cleanup.

Suggested tests:

- Add a unit test proving `runAiReviewCleanup` stores suggestions but does not update `enriched_transactions` or resolve `review_items`.
- Add a Plaid import/service test proving AI-origin suggestions create review items only, while deterministic merchant-rule cleanup can still be applied if that is intended.

### Low: AI suggestion callers pass full raw transaction rows to a structurally narrow API

Evidence:

- `src/lib/ai/types.ts:18` defines `RawTransactionSuggestionFields` as a safe `Pick` of raw transaction fields.
- `src/lib/review/ai-suggestions.ts:85` stores candidates as full `RawTransactionRow`.
- `src/lib/review/ai-suggestions.ts:102` passes that full row as `rawTransaction`.
- `src/lib/review/auto-cleanup.ts:81` loads raw rows with `.select("*")`.
- `src/lib/ai/openai-provider.ts:522` currently builds the OpenAI prompt by reading only selected safe fields.

Risk:

This is not currently leaking raw provider payloads because the OpenAI provider prompt manually interpolates only `name`, `merchant_name`, `amount`, `iso_currency_code`, `payment_channel`, and `plaid_category`. The risk is future-regression: TypeScript's structural typing allows extra `raw_payload`, `location`, `payment_meta`, provider ids, and other raw row fields to exist on the object. A later provider that serializes `request.rawTransaction` wholesale would leak more than the contract intends.

Recommended fix:

Introduce a small sanitizer such as `toRawTransactionSuggestionFields(raw)` and call it before any AI adapter receives a transaction. Consider changing internal candidate storage in `attachAiSuggestionsToReviewItems` to the narrowed type.

Suggested tests:

- Add a unit test with a raw row containing `raw_payload`, `payment_meta`, `location`, and Plaid ids, then assert the adapter receives only the narrowed safe keys.
- Keep the existing OpenAI prompt tests, but add a regression check that serialized prompt text does not contain forbidden keys.

## Areas checked with no confirmed issue

### Plaid token vault

Evidence checked:

- `src/lib/plaid/token-vault.ts:138` encrypts access tokens using AES-256-GCM with random 12-byte IVs.
- `src/lib/plaid/token-vault.ts:92` requires `PLAID_TOKEN_ENCRYPTION_KEY` in Plaid production or production runtime.
- `src/lib/plaid/service.ts:66` keeps public Plaid item columns separate from sync-only columns.
- `src/lib/plaid/service.ts:266` defines public connection summaries without `access_token_ciphertext`, `plaid_item_id`, or `transaction_cursor`.
- `src/lib/plaid/service.ts:2467` exchanges Plaid public tokens server-side and stores encrypted access tokens.

### RLS and sensitive table access

Evidence checked:

- `supabase/migrations/20260513000400_lock_down_plaid_item_sensitive_columns.sql:1` revokes client select access to Plaid token, provider item id, and cursor columns.
- `supabase/migrations/20260513000500_restrict_direct_sensitive_table_access.sql:1` revokes client select access to raw transaction location/payment/provider payload fields.
- `supabase/migrations/20260513000500_restrict_direct_sensitive_table_access.sql:9` revokes direct Plaid item writes from anon/authenticated clients.
- `supabase/migrations/20260513000500_restrict_direct_sensitive_table_access.sql:14` revokes direct agent proposal writes from anon/authenticated clients.
- `supabase/migrations/20260513000500_restrict_direct_sensitive_table_access.sql:19` revokes direct audit event writes from anon/authenticated clients.

### OpenClaw read APIs and browser/provider exposure

Evidence checked:

- `src/lib/openclaw/route-helpers.ts:27` and `src/lib/security/request.ts:88` use bearer-token auth with timing-safe comparison.
- `src/lib/openclaw/finance-read-api.ts:192`, `:224`, `:253`, `:385`, and `:425` build minimized OpenClaw responses and assert them safe.
- `src/lib/openclaw/signals.ts:149` builds the signals payload and `:181` asserts it safe.
- `src/lib/openclaw/outbox.ts:327` builds delivery messages and `:374` asserts them safe.
- `src/lib/openclaw/plaid-refresh.ts:110` summarizes Plaid refresh results and `:145` asserts the response safe.
- `src/app/api/openclaw/query/route.ts:79`, `:86`, and `:97` explicitly request `includeRawContext: false`.
- `src/app/api/openclaw/recent-transactions/route.ts:35`, `review-items/route.ts:36`, and `reimbursements/route.ts:48` also request `includeRawContext: false`.

### CRON_SECRET-protected endpoints

Evidence checked:

- `src/app/api/agents/proactive-scan/scheduled/route.ts:20` checks `CRON_SECRET`.
- `src/app/api/openclaw/anomaly-alerts/scheduled/route.ts:14` checks `CRON_SECRET`.
- `src/app/api/openclaw/briefing/scheduled/route.ts:13` checks `CRON_SECRET`.
- `src/app/api/plaid/sync/scheduled/route.ts:8` checks `CRON_SECRET`.
- `src/lib/security/request.ts:88` fails closed when the expected bearer token is missing.

## PR review checklist for Opus branches

- Check every API route touched by the PR for auth, same-origin or bearer-token checks, and no-store responses.
- Search the diff for `raw_payload`, `access_token_ciphertext`, `plaid_item_id`, `plaid_transaction_id`, `transaction_cursor`, `payment_meta`, `location`, `service_role`, and `authorization`.
- Confirm any OpenClaw/assistant/browser response uses an existing safe builder or calls `assertAssistantContextSafe`.
- Confirm service-role clients are server-only and scoped by `userId`.
- Confirm Plaid access tokens are only decrypted immediately before Plaid server calls.
- Confirm AI output creates suggestions/proposals only, unless the mutation is a deterministic non-AI rule with tests and audit events.
- Confirm migrations preserve user ownership, RLS expectations, and column-level revokes for sensitive fields.
- Run focused unit tests for changed domains plus `npm run typecheck`.

## Issue candidates

### Issue: Disable autonomous AI writes to transaction enrichment

Body:

AI review cleanup and Plaid import-time cleanup can currently apply AI-origin categorization/enrichment patches without an explicit user approval action. This conflicts with the repo guardrail that AI output is advisory and should not perform autonomous financial-record writes.

Evidence:

- `src/lib/review/auto-cleanup.ts:131-150`
- `src/lib/plaid/service.ts:1942-1995`
- `src/lib/review/auto-categorization.ts:17`

Acceptance criteria:

- AI suggestions can be stored as review/agent suggestions.
- Applying AI suggestions requires a user approval action.
- Deterministic merchant-rule cleanup, if retained, is clearly separated from AI cleanup.
- Unit tests prove AI cleanup does not call `updateTransactionEnrichment` or resolve review items automatically.

### Issue: Sanitize raw transaction rows before AI adapters receive them

Body:

`TransactionSuggestionRequest` is typed to include only selected raw transaction fields, but callers pass full `RawTransactionRow` objects. The current OpenAI provider manually reads safe fields, so no leak is confirmed today, but a future provider could serialize the object and accidentally send raw provider payloads or Plaid ids.

Acceptance criteria:

- Add a sanitizer that returns only `RawTransactionSuggestionFields`.
- Use it before every AI adapter call.
- Add regression tests proving forbidden raw fields are absent from adapter requests and OpenAI prompt text.

## Verification commands

Run:

- `npm ci` - installed dependencies for the fresh worktree; audit reported 0 vulnerabilities.
- `npm run typecheck`
- `node --import tsx --test src/lib/openclaw/*.test.ts src/lib/agents/*.test.ts src/lib/ai/*.test.ts src/lib/review/ai-suggestions.test.ts src/lib/review/auto-categorization.test.ts` - 156 tests passed.

## Files changed

- `docs/audits/fable-security-audit-20260609.md`
