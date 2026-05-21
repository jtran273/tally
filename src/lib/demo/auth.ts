import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";

export const DEMO_COOKIE_NAME = "ledger_demo";
const DEMO_COOKIE_VALUE = "1";
export const DEMO_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

export function isDemoModeEnabled() {
  const flag = process.env.ENABLE_DEMO_MODE?.trim().toLowerCase();

  if (flag) {
    return ["1", "true", "yes", "on"].includes(flag);
  }

  return !isProductionRuntime();
}

export function isDemoRequest(request: NextRequest) {
  return isDemoModeEnabled() && request.cookies.get(DEMO_COOKIE_NAME)?.value === DEMO_COOKIE_VALUE;
}

export async function isDemoMode() {
  if (!isDemoModeEnabled()) return false;

  const cookieStore = await cookies();
  return cookieStore.get(DEMO_COOKIE_NAME)?.value === DEMO_COOKIE_VALUE;
}

export function setDemoCookie(response: NextResponse) {
  response.cookies.set(DEMO_COOKIE_NAME, DEMO_COOKIE_VALUE, {
    httpOnly: true,
    maxAge: DEMO_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: isProductionRuntime()
  });
}

export function clearDemoCookie(response: NextResponse) {
  response.cookies.set(DEMO_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: isProductionRuntime()
  });
}
