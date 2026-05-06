export class PlaidConfigurationError extends Error {
  constructor(message = "Plaid is not configured.") {
    super(message);
    this.name = "PlaidConfigurationError";
  }
}

export interface PlaidConfig {
  clientId: string;
  environment: "sandbox";
  secret: string;
}

export function getPlaidConfig(): PlaidConfig {
  const clientId = process.env.PLAID_CLIENT_ID?.trim();
  const secret = process.env.PLAID_SECRET?.trim();
  const environment = process.env.PLAID_ENV?.trim().toLowerCase() || "sandbox";

  if (!clientId || !secret) {
    throw new PlaidConfigurationError("Missing Plaid server environment variables.");
  }

  if (environment !== "sandbox") {
    throw new PlaidConfigurationError("Plaid Link is currently restricted to sandbox.");
  }

  return { clientId, environment, secret };
}
