import type { InsightTone } from "@/lib/db";

export type DashboardInsightSource = "generated" | "persisted";

export interface DashboardInsightCard {
  id: string;
  key: string;
  title: string;
  body: string;
  tone: InsightTone;
  href: string;
  evidenceLabel: string;
  evidenceTransactionIds: string[];
  generatedAt: string | null;
  source: DashboardInsightSource;
}
