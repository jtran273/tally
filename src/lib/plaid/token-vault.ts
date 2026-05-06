import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getPlaidConfig } from "./config";

const TOKEN_VERSION = "v1";
const TOKEN_ALGORITHM = "aes-256-gcm";

function getTokenKey() {
  const config = getPlaidConfig();

  return createHash("sha256")
    .update("personal-finance-os:plaid-access-token:v1")
    .update(config.clientId)
    .update(config.secret)
    .digest();
}

function encode(value: Buffer) {
  return value.toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url");
}

export function encryptPlaidAccessToken(accessToken: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(TOKEN_ALGORITHM, getTokenKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(accessToken, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [TOKEN_VERSION, encode(iv), encode(tag), encode(ciphertext)].join(":");
}

export function decryptPlaidAccessToken(ciphertext: string) {
  const [version, iv, tag, encrypted] = ciphertext.split(":");

  if (version !== TOKEN_VERSION || !iv || !tag || !encrypted) {
    throw new Error("Unsupported Plaid access token ciphertext.");
  }

  const decipher = createDecipheriv(TOKEN_ALGORITHM, getTokenKey(), decode(iv));
  decipher.setAuthTag(decode(tag));

  return Buffer.concat([decipher.update(decode(encrypted)), decipher.final()]).toString("utf8");
}
