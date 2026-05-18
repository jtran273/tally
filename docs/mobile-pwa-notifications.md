# Mobile install and notification boundary

Tally should support a lightweight mobile install path, but it should not become a browser-based automation or reminder engine.

## Decision

- **Approved now:** installable PWA shell with product metadata and safe icons.
- **Deferred:** service worker caching, offline app data, offline financial writes, and browser push notifications.
- **Owned by OpenClaw:** conversational prompts, questions, reminders, and assistant-style nudges.
- **Owned by Tally later, if explicitly added:** non-conversational status alerts such as sync failures, important unresolved review items, or a scheduled briefing being ready.

This keeps Tally as the finance system of record and approval surface while OpenClaw remains the proactive conversational layer.

## Current implementation

Tally exposes `src/app/manifest.ts`, linked from root metadata, with install-friendly app metadata and maskable PNG icons in `public/icons/`.

There is intentionally no service worker in this first pass. Without a service worker, Tally does not cache authenticated finance screens or create an offline mutation surface. The app remains an online approval surface backed by Supabase, Plaid, and server-side validation.

## Security requirements for future notifications

If Tally adds browser push notifications later, the implementation must satisfy all of these requirements before prompting users:

1. Notifications are opt-in and manageable from Settings.
2. Notification copy contains no private finance data: no merchant names, amounts, account names, transaction ids, provider ids, notes, or raw payload fragments.
3. Payloads carry only routing-safe metadata, such as a notification type and app-owned opaque id.
4. Notification types do not overlap with OpenClaw conversational reminders or clarification questions.
5. The browser must not run Plaid syncs in the background or mutate finance records offline.
6. Any notification action that changes finance state must open Tally, re-read the current row for the signed-in user, show the proposed diff, require explicit confirmation, and write audit events.

Safe examples:

- `Tally sync needs attention. Open Settings to review.`
- `Important review items are waiting in Tally.`
- `Your scheduled Tally briefing is ready.`

Unsafe examples:

- `$42.18 at Merchant Name needs review.`
- `Confirm that Alex reimbursed your Venmo.`
- `Your Chase account ending 1234 failed sync.`

## Acceptance notes

- Mobile home-screen install is supported through the web app manifest and icons.
- Offline financial writes are not supported.
- Push notifications are intentionally deferred until an opt-in settings and payload-safety design exists.
- Conversational reminders remain OpenClaw's responsibility.
