export class PlaidConfigurationError extends Error {
  constructor(message = "Plaid is not configured.") {
    super(message);
    this.name = "PlaidConfigurationError";
  }
}

export interface PlaidConfig {
  clientId: string;
  environment: PlaidEnvironment;
  redirectUri: string | null;
  secret: string;
}

export type PlaidEnvironment = "sandbox" | "production";

const SUPPORTED_PLAID_ENVIRONMENTS = new Set<PlaidEnvironment>(["sandbox", "production"]);

function getPlaidEnvironment(): PlaidEnvironment {
  const environment = process.env.PLAID_ENV?.trim().toLowerCase() || "sandbox";

  if (SUPPORTED_PLAID_ENVIRONMENTS.has(environment as PlaidEnvironment)) {
    return environment as PlaidEnvironment;
  }

  throw new PlaidConfigurationError("PLAID_ENV must be set to sandbox or production.");
}

function getPlaidSecret(environment: PlaidEnvironment) {
  const scopedSecret = environment === "production"
    ? process.env.PLAID_PRODUCTION_SECRET?.trim()
    : process.env.PLAID_SANDBOX_SECRET?.trim();

  return scopedSecret || process.env.PLAID_SECRET?.trim();
}

function buildRedirectUri(path = "/settings") {
  const explicitRedirect = process.env.PLAID_REDIRECT_URI?.trim();
  if (explicitRedirect) return explicitRedirect;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
    || (process.env.VERCEL_URL?.trim() ? `https://${process.env.VERCEL_URL.trim()}` : null);
  if (!appUrl) return null;

  try {
    return new URL(path, appUrl).toString();
  } catch {
    throw new PlaidConfigurationError("Plaid app URL is invalid.");
  }
}

function assertProductionRedirectUri(redirectUri: string | null) {
  if (!redirectUri) {
    throw new PlaidConfigurationError("PLAID_REDIRECT_URI or NEXT_PUBLIC_APP_URL is required for Plaid production.");
  }

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new PlaidConfigurationError("Plaid redirect URI is invalid.");
  }

  if (parsed.protocol !== "https:") {
    throw new PlaidConfigurationError("Plaid production redirect URI must use HTTPS.");
  }
}

export function getPlaidRuntimeEnvironment(): PlaidEnvironment {
  return getPlaidEnvironment();
}

export function getPlaidConfig(): PlaidConfig {
  const clientId = process.env.PLAID_CLIENT_ID?.trim();
  const environment = getPlaidEnvironment();
  const secret = getPlaidSecret(environment);
  const redirectUri = buildRedirectUri();

  if (!clientId || !secret) {
    throw new PlaidConfigurationError("Missing Plaid server environment variables.");
  }

  if (environment === "production") {
    assertProductionRedirectUri(redirectUri);
  }

  return { clientId, environment, redirectUri, secret };
}
