const SECRET_TEXT_PATTERN = new RegExp(
  [
    // Authorization headers
    "\\bBearer\\s+\\S{12,}",
    // Postgres connection strings
    "\\b(?:postgres|postgresql):\\/\\/[^ \\n]+",
    // OpenAI keys (sk-..., sk-proj-...)
    "\\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\\b",
    // Anthropic keys (sk-ant-...)
    "\\bsk-ant-[A-Za-z0-9_-]{20,}\\b",
    // Plaid access tokens
    "\\b(?:access|public)-(?:sandbox|development|production)-[A-Za-z0-9_-]{12,}\\b",
    // Generic "service_role_key=..." assignments
    "\\bservice[_-]?role[_-]?key\\s*[:=]\\s*\\S{12,}",
    // JWTs (header.payload.signature)
    "\\beyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}\\b",
    // Google OAuth access tokens
    "\\bya29\\.[A-Za-z0-9_-]{20,}",
    // Google OAuth refresh tokens
    "\\b1\\/\\/0[A-Za-z0-9_-]{20,}",
    // GitHub tokens (ghp_, gho_, ghu_, ghs_, ghr_)
    "\\bgh[pousr]_[A-Za-z0-9]{20,}\\b",
    // AWS access keys
    "\\bAKIA[0-9A-Z]{16}\\b"
  ].join("|"),
  "gi"
);

function redactSecretText(value: string) {
  return value.replace(SECRET_TEXT_PATTERN, "[redacted]");
}

function safeErrorValue(error: unknown) {
  if (error instanceof Error) {
    return {
      message: redactSecretText(error.message),
      name: error.name
    };
  }

  if (typeof error === "string") {
    return { message: redactSecretText(error) };
  }

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    return {
      code: typeof record.code === "string" ? redactSecretText(record.code) : undefined,
      message: typeof record.message === "string" ? redactSecretText(record.message) : undefined,
      name: typeof record.name === "string" ? redactSecretText(record.name) : undefined,
      status: typeof record.status === "number" || typeof record.status === "string" ? record.status : undefined
    };
  }

  return { message: String(error) };
}

export function logSafeError(context: string, error: unknown) {
  console.error(context, safeErrorValue(error));
}
