import { NextResponse, type NextRequest } from "next/server";

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

function addOrigin(origins: Set<string>, value: string | null | undefined) {
  if (!value) return;

  try {
    origins.add(new URL(value).origin);
  } catch {
    // Ignore invalid environment values here. Dedicated config validation handles them.
  }
}

function getRequestOrigin(request: NextRequest) {
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost ?? firstHeaderValue(request.headers.get("host"));
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  const protocol = forwardedProto ?? request.nextUrl.protocol.replace(":", "");

  return host ? `${protocol}://${host}` : request.nextUrl.origin;
}

function getAllowedOrigins(request: NextRequest) {
  const origins = new Set<string>();

  addOrigin(origins, request.nextUrl.origin);
  addOrigin(origins, getRequestOrigin(request));
  addOrigin(origins, process.env.NEXT_PUBLIC_APP_URL?.trim());

  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) addOrigin(origins, `https://${vercelUrl}`);

  return origins;
}

export function noStoreHeaders(headers?: HeadersInit) {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Cache-Control", "no-store");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return responseHeaders;
}

export function jsonNoStore(body: unknown, init: ResponseInit = {}) {
  return NextResponse.json(body, {
    ...init,
    headers: noStoreHeaders(init.headers)
  });
}

export function requireSameOriginRequest(request: NextRequest) {
  const origin = request.headers.get("origin");

  if (!origin) {
    return isProductionRuntime()
      ? jsonNoStore({ error: "Invalid request origin." }, { status: 403 })
      : null;
  }

  return getAllowedOrigins(request).has(origin)
    ? null
    : jsonNoStore({ error: "Invalid request origin." }, { status: 403 });
}
