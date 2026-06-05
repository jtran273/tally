import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function firstHeaderValue(value: string | null) {
  return value?.split(",")[0]?.trim() || null;
}

function normalizeOrigin(value: string | null | undefined) {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function normalizeRequestOrigin(value: string | null | undefined) {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      return null;
    }

    return url.origin;
  } catch {
    return null;
  }
}

function addOrigin(origins: Set<string>, value: string | null | undefined) {
  const origin = normalizeOrigin(value);
  if (origin) {
    origins.add(origin);
  } else {
    // Ignore invalid environment values here. Dedicated config validation handles them.
  }
}

export function getRequestOrigin(request: NextRequest) {
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

export function timingSafeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAuthorizedBearerToken(headers: Headers, token: string | null | undefined) {
  const expectedToken = token?.trim();
  if (!expectedToken) return false;

  const authorization = headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return false;

  return timingSafeEqualText(authorization.slice(prefix.length), expectedToken);
}

export function requireSameOriginRequest(request: NextRequest) {
  const originHeader = request.headers.get("origin");

  if (!originHeader) {
    return isProductionRuntime()
      ? jsonNoStore({ error: "Invalid request origin." }, { status: 403 })
      : null;
  }

  const origin = normalizeRequestOrigin(originHeader);
  if (!origin) return jsonNoStore({ error: "Invalid request origin." }, { status: 403 });

  return getAllowedOrigins(request).has(origin)
    ? null
    : jsonNoStore({ error: "Invalid request origin." }, { status: 403 });
}

export function requireSameOriginReadRequest(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin) return requireSameOriginRequest(request);

  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["none", "same-origin", "same-site"].includes(fetchSite)) {
    return jsonNoStore({ error: "Invalid request origin." }, { status: 403 });
  }

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return getAllowedOrigins(request).has(new URL(referer).origin)
        ? null
        : jsonNoStore({ error: "Invalid request origin." }, { status: 403 });
    } catch {
      return jsonNoStore({ error: "Invalid request origin." }, { status: 403 });
    }
  }

  return isProductionRuntime()
    ? jsonNoStore({ error: "Invalid request origin." }, { status: 403 })
    : null;
}
