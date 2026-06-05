"use server";

import { revalidatePath } from "next/cache";
import {
  acceptAgentProposal,
  dismissAgentProposal,
  getEnrichedTransactionRow,
  recordAuditEvent,
  updateTransactionEnrichment,
  type FinanceSupabaseClient,
  type Json,
  type TransactionIntent
} from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";
import { isUnmatchedReimbursementIncome } from "@/lib/finance/reimbursements";

export interface AgentProposalActionState {
  error?: string;
  message?: string;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function cleanString(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function errorState(error: unknown): AgentProposalActionState {
  return {
    error: error instanceof Error ? error.message : "Unable to update agent proposal."
  };
}

function requireUuid(value: FormDataEntryValue | null, label: string) {
  const text = cleanString(value, 80);
  if (!uuidPattern.test(text)) throw new Error(`Invalid ${label}.`);
  return text;
}

async function hasReceivedReimbursementLink(
  client: FinanceSupabaseClient,
  userId: string,
  transactionId: string
) {
  const result = await client
    .from("reimbursement_records")
    .select("id")
    .eq("user_id", userId)
    .eq("received_transaction_id", transactionId);

  if (result.error) throw new Error(`Load reimbursement links for received inflow: ${result.error.message}`);
  return (result.data ?? []).length > 0;
}

export async function linkReimbursementMatchProposalAction(
  _state: AgentProposalActionState,
  formData: FormData
): Promise<AgentProposalActionState> {
  try {
    const proposalId = requireUuid(formData.get("proposalId"), "proposal id");
    const context = await getFinanceServerContext();
    if (!context.client) return { error: "Supabase is not configured." };
    if (!context.userId) return { error: "Sign in to link reimbursements." };
    if (context.isDemo) return { error: "Demo mode is read-only. Sign in to link real reimbursements." };

    await acceptAgentProposal(context.client, context.userId, proposalId, {
      actorId: context.userId,
      source: "agent_inbox_reimbursement_match_link"
    });

    revalidatePath("/agent-inbox");
    revalidatePath("/dashboard");
    revalidatePath("/transactions");

    return { message: "Reimbursement linked from agent proposal." };
  } catch (error) {
    return errorState(error);
  }
}

export async function dismissAgentProposalAction(
  _state: AgentProposalActionState,
  formData: FormData
): Promise<AgentProposalActionState> {
  try {
    const proposalId = requireUuid(formData.get("proposalId"), "proposal id");
    const context = await getFinanceServerContext();
    if (!context.client) return { error: "Supabase is not configured." };
    if (!context.userId) return { error: "Sign in to dismiss proposals." };
    if (context.isDemo) return { error: "Demo mode is read-only. Sign in to dismiss real proposals." };

    await dismissAgentProposal(context.client, context.userId, proposalId, {
      actorId: context.userId,
      source: "agent_inbox_reimbursement_match_dismiss"
    });

    revalidatePath("/agent-inbox");

    return { message: "Proposal dismissed." };
  } catch (error) {
    return errorState(error);
  }
}

export async function markUnmatchedReimbursementProposalAction(
  _state: AgentProposalActionState,
  formData: FormData
): Promise<AgentProposalActionState> {
  try {
    const proposalId = requireUuid(formData.get("proposalId"), "proposal id");
    const transactionId = requireUuid(formData.get("transactionId"), "transaction id");
    const restoredIntent = cleanString(formData.get("restoredIntent"), 24) as TransactionIntent || "personal";
    if (restoredIntent !== "personal" && restoredIntent !== "business") {
      return { error: "Choose Personal or Business income." };
    }

    const context = await getFinanceServerContext();
    if (!context.client) return { error: "Supabase is not configured." };
    if (!context.userId) return { error: "Sign in to update reimbursements." };
    if (context.isDemo) return { error: "Demo mode is read-only. Sign in to update real reimbursements." };

    const before = await getEnrichedTransactionRow(context.client, context.userId, transactionId);
    if (!before) return { error: "Transaction was not found." };
    if (before.amount <= 0) return { error: "Only positive inflows can be marked as unmatched reimbursement income." };

    const hasLink = await hasReceivedReimbursementLink(context.client, context.userId, transactionId);
    if (hasLink) {
      return { error: "Use the linked reimbursement unlink action before changing this inflow." };
    }

    const isAlreadyUnmatched = isUnmatchedReimbursementIncome({
      amount: before.amount,
      intent: before.intent,
      reimbursements: []
    });

    if (!isAlreadyUnmatched) {
      const updated = await updateTransactionEnrichment(context.client, context.userId, transactionId, {
        intent: "reimbursable",
        source: "manual"
      });

      await recordAuditEvent(context.client, context.userId, {
        action: "reimbursement.unmatched_inflow_marked",
        actorId: context.userId,
        afterData: {
          intent: updated.intent,
          isUnmatchedReimbursementIncome: true
        },
        beforeData: {
          intent: before.intent,
          isUnmatchedReimbursementIncome: false
        },
        entityId: transactionId,
        entityTable: "enriched_transactions",
        metadata: {
          amount: before.amount,
          proposalId,
          source: "agent_inbox_reimbursement_match_mark_unmatched",
          transactionId
        } satisfies Record<string, Json>
      });
    }

    await dismissAgentProposal(context.client, context.userId, proposalId, {
      actorId: context.userId,
      source: "agent_inbox_reimbursement_match_mark_unmatched"
    });

    revalidatePath("/agent-inbox");
    revalidatePath("/dashboard");
    revalidatePath("/transactions");
    revalidatePath(`/transactions/${transactionId}`);

    return { message: "Inflow marked as unmatched reimbursement income and proposal dismissed." };
  } catch (error) {
    return errorState(error);
  }
}
