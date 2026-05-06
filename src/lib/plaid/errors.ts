import { PlaidConfigurationError } from "./config";

interface SafePlaidError {
  code: string;
  requestId?: string;
  status?: number;
  type?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function getSafePlaidError(error: unknown): SafePlaidError {
  if (error instanceof PlaidConfigurationError) {
    return { code: "PLAID_CONFIGURATION_ERROR" };
  }

  const response = isRecord(error) && isRecord(error.response) ? error.response : null;
  const data = response && isRecord(response.data) ? response.data : null;

  return {
    code: asString(data?.error_code) ?? "PLAID_REQUEST_FAILED",
    requestId: asString(data?.request_id),
    status: typeof response?.status === "number" ? response.status : undefined,
    type: asString(data?.error_type)
  };
}

export function logPlaidError(context: string, error: unknown) {
  console.error(context, getSafePlaidError(error));
}

export function getPlaidErrorStatus(error: unknown) {
  if (error instanceof PlaidConfigurationError) return 503;

  const safe = getSafePlaidError(error);
  if (safe.status === 401 || safe.status === 403) return 502;
  if (safe.status && safe.status >= 400 && safe.status < 500) return 400;
  return 502;
}
