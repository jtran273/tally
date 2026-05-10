import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getPlaidCredentialConfig, PlaidConfigurationError } from "./config";

const TOKEN_VERSION = "v1";
const TOKEN_ALGORITHM = "aes-256-gcm";

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function hashKey(...parts: string[]) {
  const hash = createHash("sha256");
  parts.forEach((part) => hash.update(part));
  return hash.digest();
}

function getLegacyTokenKey() {
  const config = getPlaidCredentialConfig();

  return hashKey(
    "personal-finance-os:plaid-access-token:v1",
    config.clientId,
    config.secret
  );
}

function getPrimaryTokenKey() {
  const explicitKey = process.env.PLAID_TOKEN_ENCRYPTION_KEY?.trim();

  if (explicitKey) {
    return hashKey("personal-finance-os:plaid-access-token:explicit:v1", explicitKey);
  }

  if (isProductionRuntime()) {
    throw new PlaidConfigurationError("PLAID_TOKEN_ENCRYPTION_KEY is required in production.");
  }

  return getLegacyTokenKey();
}

function getDecryptionKeyCandidates() {
  return [
    getPrimaryTokenKey,
    getLegacyTokenKey
  ];
}

function encode(value: Buffer) {
  return value.toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url");
}

export function encryptPlaidAccessToken(accessToken: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(TOKEN_ALGORITHM, getPrimaryTokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(accessToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [TOKEN_VERSION, encode(iv), encode(tag), encode(ciphertext)].join(":");
}

export function decryptPlaidAccessToken(ciphertext: string) {
  const [version, iv, tag, encrypted] = ciphertext.split(":");

  if (version !== TOKEN_VERSION || !iv || !tag || !encrypted) {
    throw new Error("Unsupported Plaid access token ciphertext.");
  }

  let lastError: unknown;

  for (const getKey of getDecryptionKeyCandidates()) {
    try {
      const key = getKey();
      const decipher = createDecipheriv(TOKEN_ALGORITHM, key, decode(iv));
      decipher.setAuthTag(decode(tag));

      return Buffer.concat([decipher.update(decode(encrypted)), decipher.final()]).toString("utf8");
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Unable to decrypt Plaid access token.");
}
