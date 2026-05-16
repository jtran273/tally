const SECRET_TEXT_PATTERN =
  /\bBearer\s+\S{12,}|\b(?:postgres|postgresql):\/\/[^ \n]+|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b|\b(?:access|public)-(?:sandbox|development|production)-[A-Za-z0-9_-]{12,}\b|\bservice[_-]?role[_-]?key\s*[:=]\s*\S{12,}/gi;

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
