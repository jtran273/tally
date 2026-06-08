# Runbook: Verify Google Calendar production OAuth and planning signals (issue #112)

The read-only Google Calendar connector is built (OAuth routes, encrypted token
storage/refresh, Settings connect/disconnect UI, a bounded event reader, the
redacted upcoming-calendar context, OpenClaw signal inclusion, docs, and tests).
The remaining work is production OAuth setup and live validation.

Product framing: this is not a generic calendar feature. Calendar data is useful
only when it changes a finance-facing output such as safe-to-spend pressure,
OpenClaw budget briefing questions, reimbursement/shared-expense prompts, or
transaction review context. See `../calendar-aware-finance-context.md`.

> Do not paste OAuth client secrets, tokens, the token encryption key, or raw
> Google event payloads into issues, PRs, or chat.

## Configuration surface

| Env var | Purpose |
| --- | --- |
| `GOOGLE_CALENDAR_CLIENT_ID` | OAuth client id |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | OAuth client secret |
| `GOOGLE_CALENDAR_REDIRECT_URI` | Must be HTTPS and end in `/api/calendar/callback` |
| `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` | Encrypts stored refresh tokens |

Optional, to exercise the live signals check in the smoke script:

| Env var | Purpose |
| --- | --- |
| `OPENCLAW_SIGNALS_URL` | `https://<prod-host>/api/openclaw/signals` (https required unless localhost) |
| `OPENCLAW_TOKEN` | Bearer for the signals endpoint (never printed) |

## 1. Configure Google Cloud + Vercel

1. In Google Cloud Console, add the production **authorized redirect URI**:
   `https://<prod-host>/api/calendar/callback`.
2. Set the four `GOOGLE_CALENDAR_*` env vars in the production environment.
   `GOOGLE_CALENDAR_REDIRECT_URI` must be HTTPS and point at
   `/api/calendar/callback` (the smoke script asserts both).

Production OAuth should be pinned to
`https://personal-finance-os-jtran273s-projects.vercel.app/api/calendar/callback`.
The app has had both `personal-finance-os-lac.vercel.app` and
`personal-finance-os-jtran273s-projects.vercel.app` live; mixing those hosts can
make OAuth cookies/state look missing even when the Google redirect itself
succeeds. Start and finish the Settings connect/refresh flow on the `-jtran273s`
host when validating production.

## 2. Run the production smoke check

Start with the consolidated local/env-shape preflight:

```bash
npm run ops:preflight
```

With the production Calendar env loaded:

```bash
# env-only + offline category inference checks:
npm run calendar:prod-smoke

# optionally also hit the live signals endpoint:
export OPENCLAW_SIGNALS_URL="https://<prod-host>/api/openclaw/signals"
export OPENCLAW_TOKEN="<token>"
npm run calendar:prod-smoke
```

The script verifies env presence and redirect-URI shape, confirms category
inference offline (travel/dining/gift/wedding), and — when the signals vars are
set — asserts the live `calendarContext` only exposes the bounded fields
(`all_day`, `end`, `locationCity`, `start`, `suspected_category`, `title`) and no
attendee emails, descriptions, raw Google payloads, tokens, or secrets. It never
prints secret values.

If `ops:preflight` reports `BLOCKED` for #112, stop there. The remaining steps
need production OAuth configuration and a signed-in browser session.

## 3. Verify connect/disconnect (acceptance criterion 2)

Sign in to production with a personal account:

1. **Settings** → connect Google Calendar; complete the OAuth consent.
2. Confirm the Settings card shows connected state.
3. Disconnect; confirm the card returns to the not-connected state and stored
   tokens are removed.

## 4. Verify signal quality (acceptance criteria 3, 5)

1. With a calendar connected, fetch `/api/openclaw/signals` (authorized) and
   confirm `calendarContext.status` is `"ready"` **only** when connected.
2. Confirm at least one live upcoming event yields useful category inference
   (e.g. travel, dinner, gift, or wedding).
3. Re-confirm the bounded-field contract on the live payload (the smoke script's
   signals check does this automatically when configured).
4. Confirm at least one finance-facing output can use the calendar pressure,
   such as safe-to-spend explanation copy, an OpenClaw budget briefing question,
   or a reimbursement/review prompt.

## 5. Verify clean failure states (acceptance criterion 6)

Confirm each state renders cleanly without leaking internals:

- **not configured** (env missing),
- **auth denied** (user declines consent),
- **expired state** (stale OAuth `state`),
- **disconnected** (after step 3).

## 6. Close out

When production OAuth is configured, connect/disconnect works, signals are
`ready` only when connected, the bounded-field contract holds on live data, at
least one useful category inference is observed, and failure states are clean —
update issue #112 with the results (no secrets) and close it.
