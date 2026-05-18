import { type NextRequest } from "next/server";
import {
  createDisabledProactiveScanResult,
  createProactiveScanServiceContext,
  ProactiveScanConfigurationError,
  resolveProactiveScanEnabled,
  resolveProactiveScanMaxTransactions,
  runProactiveReimbursementScan
} from "@/lib/agents/proactive-scan";
import { logSafeError } from "@/lib/security/logging";
import { isAuthorizedBearerToken, jsonNoStore } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function isAuthorizedProactiveScanScheduleRequest(headers: Headers) {
  return isAuthorizedBearerToken(headers, process.env.CRON_SECRET);
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedProactiveScanScheduleRequest(request.headers)) {
    return jsonNoStore({ error: "Scheduled proactive scan is not authorized." }, { status: 401 });
  }

  const maxTransactions = resolveProactiveScanMaxTransactions();
  if (!resolveProactiveScanEnabled()) {
    return jsonNoStore({ scan: createDisabledProactiveScanResult({ maxTransactions }) });
  }

  try {
    const { client, userId } = createProactiveScanServiceContext();
    const scan = await runProactiveReimbursementScan(client, userId, {
      maxTransactions
    });

    return jsonNoStore({ scan }, { status: scan.status === "failed" ? 502 : 200 });
  } catch (error) {
    if (error instanceof ProactiveScanConfigurationError) {
      return jsonNoStore({ error: "Proactive scan is not configured." }, { status: 503 });
    }

    logSafeError("proactive_scan_scheduled_failed", error);
    return jsonNoStore({ error: "Unable to run proactive scan." }, { status: 500 });
  }
}

export const GET = POST;
