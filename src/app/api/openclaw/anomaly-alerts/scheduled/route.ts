import { type NextRequest } from "next/server";
import {
  AnomalyAlertScanConfigurationError,
  createAnomalyAlertScanServiceContext,
  resolveAnomalyAlertScanMaxTransactions,
  runAnomalyAlertScan
} from "@/lib/anomaly/service";
import { logSafeError } from "@/lib/security/logging";
import { isAuthorizedBearerToken, jsonNoStore } from "@/lib/security/request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function isAuthorizedAnomalyAlertScheduleRequest(headers: Headers) {
  return isAuthorizedBearerToken(headers, process.env.CRON_SECRET);
}

export async function POST(request: NextRequest) {
  if (!isAuthorizedAnomalyAlertScheduleRequest(request.headers)) {
    return jsonNoStore({ error: "Scheduled anomaly alert scan is not authorized." }, { status: 401 });
  }

  try {
    const { client, userId } = createAnomalyAlertScanServiceContext();
    const scan = await runAnomalyAlertScan(client, userId, {
      maxTransactions: resolveAnomalyAlertScanMaxTransactions()
    });

    return jsonNoStore({ scan }, { status: scan.status === "failed" ? 502 : 200 });
  } catch (error) {
    if (error instanceof AnomalyAlertScanConfigurationError) {
      return jsonNoStore({ error: "Anomaly alert scan is not configured." }, { status: 503 });
    }

    logSafeError("anomaly_alert_scan_scheduled_failed", error);
    return jsonNoStore({ error: "Unable to run anomaly alert scan." }, { status: 500 });
  }
}
