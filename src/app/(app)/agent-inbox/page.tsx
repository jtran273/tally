import { AgentInboxView } from "@/components/finance/agent-inbox/agent-inbox-view";
import {
  buildAgentInboxProposals,
  summarizeAgentInbox,
  type AgentInboxProposal
} from "@/lib/agents/proposal-inbox";
import { listReviewItems, type ReviewQueueItem } from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";

export const dynamic = "force-dynamic";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to load agent proposal inbox.";
}

export default async function AgentInboxPage() {
  let dataError: string | undefined;
  let isConfigured = false;
  let isDemo = false;
  let isSignedIn = false;
  let reviewItems: ReviewQueueItem[] = [];
  let proposals: AgentInboxProposal[] = [];

  const context = await getFinanceServerContext();
  isConfigured = context.isConfigured;
  isDemo = context.isDemo;
  isSignedIn = context.isSignedIn;
  dataError = context.dataError;

  if (context.client && context.userId) {
    try {
      reviewItems = await listReviewItems(context.client, context.userId, "open");
      proposals = buildAgentInboxProposals(reviewItems);
    } catch (loadError) {
      dataError = errorMessage(loadError);
    }
  }

  return (
    <AgentInboxView
      dataError={dataError}
      isConfigured={isConfigured}
      isDemo={isDemo}
      isSignedIn={isSignedIn}
      proposals={proposals}
      summary={summarizeAgentInbox(proposals)}
    />
  );
}
