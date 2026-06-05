"use server";

import { revalidatePath } from "next/cache";
import {
  createCreditScoreSnapshot,
  recordAuditEvent,
  type CreditScoreModel,
  type CreditScoreSource,
  type Json
} from "@/lib/db";
import { getFinanceServerContext } from "@/lib/demo/server";
import { normalizeCreditScoreSnapshot } from "@/lib/finance/credit-health";

export interface CreditScoreSnapshotActionState {
  error?: string;
  message?: string;
}

const sources = new Set<CreditScoreSource>(["manual_bureau", "manual_issuer", "demo"]);
const models = new Set<CreditScoreModel>(["fico", "vantagescore", "unknown"]);

function cleanString(value: FormDataEntryValue | null, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function errorState(error: unknown): CreditScoreSnapshotActionState {
  return {
    error: error instanceof Error ? error.message : "Unable to save credit score snapshot."
  };
}

export async function addCreditScoreSnapshotAction(
  _state: CreditScoreSnapshotActionState,
  formData: FormData
): Promise<CreditScoreSnapshotActionState> {
  try {
    const rawScore = cleanString(formData.get("score"), 12);
    const score = Number.parseInt(rawScore, 10);
    if (!Number.isFinite(score)) return { error: "Enter a credit score from 300 to 850." };

    const source = cleanString(formData.get("source"), 32) as CreditScoreSource;
    if (!sources.has(source) || source === "demo") return { error: "Choose issuer or bureau as the manual score source." };

    const model = cleanString(formData.get("model"), 32) as CreditScoreModel;
    if (!models.has(model)) return { error: "Choose FICO, VantageScore, or Unknown." };

    const asOfDate = cleanString(formData.get("asOfDate"), 10);
    const snapshot = normalizeCreditScoreSnapshot({
      asOfDate,
      model,
      score,
      source
    });

    const context = await getFinanceServerContext();
    if (!context.client) return { error: "Supabase is not configured." };
    if (!context.userId) return { error: "Sign in to save credit score snapshots." };
    if (context.isDemo) return { error: "Demo mode is read-only. Sign in to save real credit score snapshots." };

    const saved = await createCreditScoreSnapshot(context.client, context.userId, snapshot);
    await recordAuditEvent(context.client, context.userId, {
      action: "credit_score_snapshot.created",
      actorId: context.userId,
      afterData: {
        asOfDate: saved.asOfDate,
        model: saved.model,
        score: saved.score,
        source: saved.source
      } satisfies Record<string, Json>,
      beforeData: null,
      entityId: saved.id,
      entityTable: "credit_score_snapshots",
      metadata: {
        source: "credit_health_manual_snapshot"
      }
    });

    revalidatePath("/credit-health");
    return { message: "Manual credit score snapshot saved." };
  } catch (error) {
    return errorState(error);
  }
}
