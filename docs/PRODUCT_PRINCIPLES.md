# Product Principles

Last updated: 2026-05-18

Tally should stay low-cognitive-load and proactive. James prefers fewer visible panels, fewer reports, and fewer meta-metrics in the day-to-day product. The app should help him trust connected finance data and answer the next useful question without making him manage the app itself.

## Direction

- Prefer one clear next action over a dashboard of diagnostics.
- Keep the dashboard centered on Cash flow, Inflows / liquid assets, and Net worth; credit-card actions are acceptable when they answer the next payment decision instead of becoming a diagnostics report.
- Keep advanced/debug views available, but do not make them prominent in normal navigation.
- Preserve backend auditability, data integrity, and deterministic calculations when they are cheap and useful.
- Hide or collapse visible complexity unless it directly helps James make a finance decision now.
- Keep Review focused on resolving exceptions. Avoid reporting panels about AI performance in the review workflow.
- Keep Dashboard focused on one or two practical questions, such as "what changed?" or "what needs attention?"
- Use progressive disclosure for details, especially cashflow, audit, and quality/debug information.
- Treat AI output as advisory. It should help reduce manual review, not become another surface James must supervise.

## Recent Product Feedback

James's May 18, 2026 feedback after PRs #140, #142, #143, #144, #150, #151, #155, #157, and #158 was to simplify Tally back toward lower cognitive load and higher proactive value.

Specific implications:

- The Review AI suggestion quality panel from #144 is too report-like for the main workflow.
- Dashboard additions from #142, #143, and #151 should not turn spending rows into accounting/debug reports.
- `/audit` should remain useful as an advanced trail, but it should not read as a normal product feature.
- Future agents should choose deletion, hiding, collapsing, or progressive disclosure before adding new panels.
