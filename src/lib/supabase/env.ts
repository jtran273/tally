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
    throw new Error("Supabase URL must be a valid URL.");
  }

  if (isProductionRuntime() && url.protocol !== "https:") {
    throw new Error("Supabase URL must use HTTPS in production.");
  }

  url.pathname = url.pathname.replace(/\/(auth|functions|rest|storage)\/v1\/?$/i, "");
  url.search = "";
  url.hash = "";

  return url.origin;
}

function firstPresentEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }

  return null;
}

export function getSupabaseConfig(): SupabaseConfig | null {
  const url = firstPresentEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
  const anonKey = firstPresentEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY");

  if (!url || !anonKey) {
    return null;
  }

  return { anonKey, url: normalizeSupabaseUrl(url) };
}

export function getRequiredSupabaseConfig(): SupabaseConfig {
  const config = getSupabaseConfig();

  if (!config) {
    throw new Error(
      "Missing Supabase environment variables. Set NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY."
    );
  }

  return config;
}
