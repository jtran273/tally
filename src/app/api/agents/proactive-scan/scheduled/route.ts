import { type NextRequest } from "next/server";
import {
  createProactiveScanServiceContext,
  ProactiveScanConfigurationError,
  resolveProactiveScanMaxTransactions,
  runProactiveReimbursementScan
} from "@/lib/agents/proactive-scan";
import { jsonNoStore } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function isAuthorizedProactiveScanScheduleRequest(headers: Headers) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;

  return headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedProactiveScanScheduleRequest(request.headers)) {
    return jsonNoStore({ error: "Scheduled proactive scan is not authorized." }, { status: 401 });
  }

  try {
    const { client, userId } = createProactiveScanServiceContext();
    const scan = await runProactiveReimbursementScan(client, userId, {
      maxTransactions: resolveProactiveScanMaxTransactions()
    });

    return jsonNoStore({ scan }, { status: scan.status === "failed" ? 502 : 200 });
  } catch (error) {
    if (error instanceof ProactiveScanConfigurationError) {
      return jsonNoStore({ error: "Proactive scan is not configured." }, { status: 503 });
    }

    console.error("proactive_scan_scheduled_failed", error);
    return jsonNoStore({ error: "Unable to run proactive scan." }, { status: 500 });
  }
}

export const GET = POST;
