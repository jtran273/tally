import { ClipboardList, Sparkles } from "lucide-react";
import type { AiSuggestionProviderKind } from "@/lib/ai/types";
import type { CategoryRecord, ReviewQueueItem } from "@/lib/db";
import type { AgentInboxProposal, AgentInboxSummary } from "@/lib/agents/proposal-inbox";
import { AgentInboxView } from "@/components/finance/agent-inbox/agent-inbox-view";
import { ReviewQueueView } from "./review-queue-view";
import { isFeatureEnabled } from "@/lib/features";
import styles from "./unified-review.module.css";

interface UnifiedReviewViewProps {
  aiProviderKind: AiSuggestionProviderKind;
  categories: CategoryRecord[];
  dataError?: string;
  isConfigured: boolean;
  isDemo: boolean;
  isSignedIn: boolean;
  proposals: AgentInboxProposal[];
  proposalSummary: AgentInboxSummary;
  reviewItems: ReviewQueueItem[];
}

export function UnifiedReviewView({
  aiProviderKind,
  categories,
  dataError,
  isConfigured,
  isDemo,
  isSignedIn,
  proposals,
  proposalSummary,
  reviewItems
}: UnifiedReviewViewProps) {
  return (
    <div className={styles.shell}>
      <section className={styles.section} aria-labelledby="review-section-field-suggestions">
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle} id="review-section-field-suggestions">
            <Sparkles size={18} aria-hidden /> Field suggestions
            <span className={styles.count}>{reviewItems.length.toLocaleString("en-US")}</span>
          </h2>
          <p>Per-transaction AI category and intent suggestions. Accept, ask AI, or edit each one.</p>
        </div>
        <ReviewQueueView
          aiProviderKind={aiProviderKind}
          categories={categories}
          dataError={dataError}
          isConfigured={isConfigured}
          isDemo={isDemo}
          isSignedIn={isSignedIn}
          reviewItems={reviewItems}
        />
      </section>

      {isFeatureEnabled("agentProposals") ? (
        <section className={styles.section} aria-labelledby="review-section-proposals">
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle} id="review-section-proposals">
              <ClipboardList size={18} aria-hidden /> Proposals
              <span className={styles.count}>{proposalSummary.totalCount.toLocaleString("en-US")}</span>
            </h2>
            <p>Agent proposals like reimbursement candidates and clarification requests.</p>
          </div>
          <AgentInboxView
            dataError={dataError}
            isConfigured={isConfigured}
            isDemo={isDemo}
            isSignedIn={isSignedIn}
            proposals={proposals}
            summary={proposalSummary}
          />
        </section>
      ) : null}
    </div>
  );
}
