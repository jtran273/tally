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

export type PlaidCredentialConfig = Omit<PlaidConfig, "redirectUri">;

export type PlaidEnvironment = "sandbox" | "production";

const SUPPORTED_PLAID_ENVIRONMENTS = new Set<PlaidEnvironment>(["sandbox", "production"]);
const LOCALHOST_NAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

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

function buildRedirectUriFromAppUrl(appUrl: string, path: string) {
  try {
    return new URL(path, appUrl).toString();
  } catch {
    throw new PlaidConfigurationError("Plaid app URL is invalid.");
  }
}

function getAppUrlCandidates() {
  return [
    process.env.NEXT_PUBLIC_APP_URL?.trim() || null,
    process.env.VERCEL_URL?.trim() ? `https://${process.env.VERCEL_URL.trim()}` : null
  ].filter((value): value is string => Boolean(value));
}

function buildRedirectUri(path = "/settings") {
  const explicitRedirect = process.env.PLAID_REDIRECT_URI?.trim();
  if (explicitRedirect) return explicitRedirect;

  const appUrl = getAppUrlCandidates()[0];
  return appUrl ? buildRedirectUriFromAppUrl(appUrl, path) : null;
}

function buildHttpsNextPublicAppRedirectUri(path = "/settings") {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) return null;

  const redirectUri = buildRedirectUriFromAppUrl(appUrl, path);
  if (new URL(redirectUri).protocol === "https:") {
    return redirectUri;
  }

  return null;
}

function normalizeProductionLinkTokenRedirectUri(redirectUri: string | null) {
  if (!redirectUri) return null;

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new PlaidConfigurationError("Plaid redirect URI is invalid.");
  }

  if (parsed.protocol === "https:") return redirectUri;

  if (parsed.protocol === "http:" && LOCALHOST_NAMES.has(parsed.hostname)) {
    return buildHttpsNextPublicAppRedirectUri();
  }

  throw new PlaidConfigurationError("Plaid production redirect URI must use HTTPS.");
}

export function getPlaidRuntimeEnvironment(): PlaidEnvironment {
  return getPlaidEnvironment();
}

export function getPlaidCredentialConfig(): PlaidCredentialConfig {
  const clientId = process.env.PLAID_CLIENT_ID?.trim();
  const environment = getPlaidEnvironment();
  const secret = getPlaidSecret(environment);

  if (!clientId || !secret) {
    throw new PlaidConfigurationError("Missing Plaid server environment variables.");
  }

  return { clientId, environment, secret };
}

export function getPlaidConfig(): PlaidConfig {
  const credentialConfig = getPlaidCredentialConfig();
  const redirectUri = buildRedirectUri();

  return { ...credentialConfig, redirectUri };
}

export function getPlaidLinkTokenConfig(): PlaidConfig {
  const config = getPlaidConfig();

  if (config.environment === "production") {
    return {
      ...config,
      redirectUri: normalizeProductionLinkTokenRedirectUri(config.redirectUri)
    };
  }

  return config;
}
