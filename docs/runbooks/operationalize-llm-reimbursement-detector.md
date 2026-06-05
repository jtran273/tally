# Runbook: Operationalize the LLM reimbursement candidate detector (issue #111)

The detector code is shipped (heuristic prefilter, mock/OpenAI providers, safe
candidate persistence, deduping, a scheduled scan route behind a cron secret,
and caps). What remains is production activation and a real-data quality review.

> Do not paste OpenAI keys, service-role keys, cron secrets, or raw Plaid
> payloads into issues, PRs, or chat.

## Configuration surface

| Env var | Purpose | Default if unset |
| --- | --- | --- |
| `ENABLE_OPENAI_AUTO_REVIEW` | Master flag; `true` turns on OpenAI-backed review | off (`false`) |
| `OPENAI_API_KEY` | OpenAI credential; absence forces the mock provider | mock provider |
| `OPENAI_MODEL` | Model id used for suggestions | `gpt-5-nano` |
| `PROACTIVE_SCAN_ENABLED` | Enables the proactive scan path | off (`false`) |
| `PROACTIVE_SCAN_MAX_TX` | Per-run transaction cap | `100` |
| `PROACTIVE_SCAN_USER_ID` (or `OPENCLAW_USER_ID`) | Account the scan runs for | none (required) |
| `SUPABASE_SERVICE_ROLE_KEY` | Lets the scheduled job bypass RLS | none (required) |
| `CRON_SECRET` | Bearer guard for the scheduled route | none (route refuses without it) |

## 1. Preflight the configuration (read-only, no secrets printed)

With the production server env loaded:

```bash
npm run reimbursement:preflight
```

It reports the **effective** configuration using the same resolvers the runtime
uses (so what it shows is what the scan will do), printing only whether each
secret is set — never its value. Exit code is non-zero while required
credentials are missing.

## 2. Activate intentionally

Set the env vars above in the production environment. Keep the master flags
(`ENABLE_OPENAI_AUTO_REVIEW`, `PROACTIVE_SCAN_ENABLED`) **off** until the
credentials, scan user, and cap are in place — that is the safe default the
preflight reports.

Start conservative: a small `PROACTIVE_SCAN_MAX_TX` for the first runs so a bad
prompt or threshold cannot create a flood of proposals.

## 3. Do a limited production run

Trigger the scheduled scan route once with the cron secret (the route rejects
requests without a matching `Authorization: Bearer <CRON_SECRET>`):

```bash
curl -sS -X POST "https://<prod-host>/api/agents/proactive-scan/scheduled" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected (acceptance criterion 2): it creates safe `reimbursement_candidate`
proposals with **no** raw Plaid payloads, provider ids, tokens, or unnecessary
PII. Inspect a few of the created proposals to confirm.

## 4. Review quality against real transactions (acceptance criteria 3–4)

- Volume: is the number of proposals reasonable for the window scanned?
- False positives: are non-reimbursable expenses being proposed?
- Misses: are obvious reimbursable expenses being skipped?

Adjust thresholds, the prefilter rules, and the prompt based on what you see.
The prefilter and persistence live in `src/lib/review/reimbursement-candidates.ts`;
the scan orchestration in `src/lib/agents/proactive-scan.ts`.

## 5. Operate safely (acceptance criteria 5–6)

- Document/observe OpenAI cost and rate limits for the cadence you run.
- Confirm the detector can be **disabled** without breaking the app: set
  `ENABLE_OPENAI_AUTO_REVIEW=false` (and/or `PROACTIVE_SCAN_ENABLED=false`) and
  verify dashboard, transactions, and review workflows still function (they fall
  back to the mock provider / no-op scan).

## 6. Close out

Record the chosen config, the limited-run results, and any threshold/prompt
adjustments (no secrets) on issue #111, then close it.
