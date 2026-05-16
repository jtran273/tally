import { isDemoModeEnabled, setDemoCookie } from "@/lib/demo/auth";
import { getRequestOrigin, jsonNoStore, requireSameOriginRequest } from "@/lib/security/request";
import { NextResponse, type NextRequest } from "next/server";

function normalizeRedirectPath(value: FormDataEntryValue | null) {
  const path = typeof value === "string" ? value : "/";

  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/login")) {
    return "/";
  }

  return path;
}

export async function POST(request: NextRequest) {
  const originError = requireSameOriginRequest(request);
  if (originError) return originError;

  if (!isDemoModeEnabled()) {
    return jsonNoStore({ error: "Demo mode is disabled." }, { status: 403 });
  }

  const formData = await request.formData();
  const redirectOrigin = request.headers.get("origin") ?? getRequestOrigin(request);
  const redirectUrl = new URL(normalizeRedirectPath(formData.get("redirectTo")), redirectOrigin);
  const response = NextResponse.redirect(redirectUrl, { status: 303 });

  setDemoCookie(response);

  return response;
}
