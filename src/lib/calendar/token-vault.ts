import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getGoogleCalendarConfig, GoogleCalendarConfigurationError } from "./config";

const TOKEN_VERSION = "v1";
const TOKEN_ALGORITHM = "aes-256-gcm";

export class GoogleCalendarTokenDecryptionError extends Error {
  constructor() {
    super("Unable to decrypt Google Calendar token.");
    this.name = "GoogleCalendarTokenDecryptionError";
  }
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function hashKey(...parts: string[]) {
  const hash = createHash("sha256");
  parts.forEach((part) => hash.update(part));
  return hash.digest();
}

function getLegacyTokenKey() {
  const config = getGoogleCalendarConfig();

  return hashKey(
    "personal-finance-os:google-calendar-token:v1",
    config.clientId,
    config.clientSecret
  );
}

function getExplicitTokenKey() {
  const explicitKey = process.env.GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY?.trim();

  return explicitKey
    ? hashKey("personal-finance-os:google-calendar-token:explicit:v1", explicitKey)
    : null;
}

function getPrimaryTokenKey() {
  const explicitKey = getExplicitTokenKey();

  if (explicitKey) return explicitKey;

  if (isProductionRuntime()) {
    throw new GoogleCalendarConfigurationError("GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY is required in production.");
  }

  return getLegacyTokenKey();
}

function getDecryptionKeys() {
  const primary = getExplicitTokenKey();

  if (!primary) return [getLegacyTokenKey()];

  try {
    const legacy = getLegacyTokenKey();

    return primary.equals(legacy) ? [primary] : [primary, legacy];
  } catch {
    return [primary];
  }
}

function encode(value: Buffer) {
  return value.toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url");
}

export function encryptGoogleCalendarToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(TOKEN_ALGORITHM, getPrimaryTokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [TOKEN_VERSION, encode(iv), encode(tag), encode(ciphertext)].join(":");
}

export function decryptGoogleCalendarToken(ciphertext: string) {
  const [version, iv, tag, encrypted] = ciphertext.split(":");

  if (version !== TOKEN_VERSION || !iv || !tag || !encrypted) {
    throw new Error("Unsupported Google Calendar token ciphertext.");
  }

  for (const key of getDecryptionKeys()) {
    try {
      const decipher = createDecipheriv(TOKEN_ALGORITHM, key, decode(iv));
      decipher.setAuthTag(decode(tag));

      return Buffer.concat([decipher.update(decode(encrypted)), decipher.final()]).toString("utf8");
    } catch {
      // Try the next known key. Production can read legacy ciphertext after key rotation.
    }
  }

  throw new GoogleCalendarTokenDecryptionError();
}
