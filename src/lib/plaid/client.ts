import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { getPlaidCredentialConfig } from "./config";

export function getPlaidClient() {
  const config = getPlaidCredentialConfig();

  return new PlaidApi(new Configuration({
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": config.clientId,
        "PLAID-SECRET": config.secret,
        "Plaid-Version": "2020-09-14"
      }
    },
    basePath: PlaidEnvironments[config.environment]
  }));
}
