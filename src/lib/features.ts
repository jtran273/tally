/**
 * Central feature flags.
 *
 * One place to turn whole features on/off. A disabled feature is hidden from
 * the UI everywhere (nav, panels, sections, forms) but its code stays in the
 * repo, so flipping a flag back to `true` fully restores it — no migration,
 * no rebuild of deleted work.
 *
 * Keep this list as the canonical inventory of optional features. When you
 * find you never re-enable one, that's your signal it's safe to delete for
 * real.
 *
 * These are plain constants so they work identically in Server Components and
 * Client Components. Edit the boolean and redeploy to change what's visible.
 */

export type FeatureName =
  | "reimbursements"
  | "netGrossToggle"
  | "auditPage"
  | "agentProposals";

export const FEATURES: Record<FeatureName, boolean> = {
  // Reimbursement tracking: outstanding/received reconciliation, link panels,
  // historical scan, and the "Reimbursable" transaction flag. Disabled while
  // the workflow is rough — spending just shows the simple gross number.
  reimbursements: false,

  // Net-after-reimbursement vs. gross spending toggle on the Transactions page.
  // Only meaningful alongside `reimbursements`; off => one straightforward
  // spending total.
  netGrossToggle: false,

  // Advanced audit / debug history page and its deep links. Power-user surface,
  // not core budgeting.
  auditPage: false,

  // AI-generated proposals in the Review queue (reimbursement candidates,
  // clarifications, budget proposals). Off => Review shows field suggestions
  // only.
  agentProposals: false
};

export function isFeatureEnabled(name: FeatureName): boolean {
  return FEATURES[name];
}
