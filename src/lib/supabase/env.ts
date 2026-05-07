export interface SupabaseConfig {
  anonKey: string;
  url: string;
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

function normalizeSupabaseUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid URL.");
  }

  if (isProductionRuntime() && url.protocol !== "https:") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTPS in production.");
  }

  url.pathname = url.pathname.replace(/\/(auth|functions|rest|storage)\/v1\/?$/i, "");
  url.search = "";
  url.hash = "";

  return url.origin;
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    return null;
  }

  return { anonKey, url: normalizeSupabaseUrl(url) };
}

export function getRequiredSupabaseConfig(): SupabaseConfig {
  const config = getSupabaseConfig();

  if (!config) {
    throw new Error(
      "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY."
    );
  }

  return config;
}
