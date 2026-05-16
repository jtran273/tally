# Tally Design System

Tally uses the design handoff in `src/app/globals.css` as the source of truth for product styling: paper canvas, sage accent, quiet semantic colors, Instrument Serif headings, Inter Tight UI text, and JetBrains Mono for amounts, counts, masks, and timestamps.

## Tokens

- Surfaces and text use `--bg`, `--surface`, `--surface-2`, `--surface-3`, `--ink`, `--ink-2`, `--muted`, `--muted-2`, `--line`, and `--line-2`.
- Sage is the only brand accent. Use `--sage` for non-text UI, `--sage-ink` for text, and `--sage-soft` for hover, badges, and tonal backgrounds.
- Semantic states use `--pos`, `--neg`, `--warn`, `--warn-ink`, `--info`, and their soft background tokens. Color must be paired with text, iconography, or explicit labels.
- Spacing should stay on the `--space-*` scale. Cards use `--radius-card`; compact controls use `--radius-control`.
- Motion should use `--dur-fast`, `--dur-base`, `--dur-slow`, `--ease-standard`, and `--ease-emphasized`, and must sit inside `prefers-reduced-motion: no-preference` unless it is essential.

## Components

Reusable app primitives live in `src/components/ui/primitives.tsx`:

- `Button` and `LinkButton` for commands and link actions.
- `Panel` and `PanelHeader` for bordered content regions.
- `SectionHeading` and `Eyebrow` for consistent page and section hierarchy.
- `MetricGrid` and `MetricCard` for numeric summaries.
- `Badge` and `Notice` for status labels and feedback.

Use these primitives before adding page-local card, badge, notice, or button styles. Page modules should handle layout-specific details only.

## Brand

The product name is Tally. The Tally mark is implemented as `src/components/brand/tally-mark.tsx` and appears in the authenticated shell and login screen. Public UI copy, docs, Plaid Link `client_name`, and user-facing assistant text should use Tally.

Internal code identifiers such as `LedgerTransaction`, `ledger_demo`, `src/components/ledger`, and protocol literals like `source: "ledger"` are legacy implementation or integration names. Rename them only as a deliberate compatibility migration.

## Accessibility

- Do not use sage as text unless it is `--sage-ink`.
- Keep focus states visible; prefer the global focus ring and tokenized control borders.
- Do not rely on color alone for state or meaning.
- Verify narrow screens down to 320px wide and reduced-motion mode before shipping broad UI changes.
