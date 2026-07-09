import { getSupabaseConfig } from "@/lib/supabase/env";
import { NetworkCheckClient } from "./network-check-client";

export const dynamic = "force-dynamic";

const fallbackAppHost = "personal-finance-os-lac.vercel.app";

export default function NetworkCheckPage() {
  const supabaseConfig = getSupabaseConfig();
  const appHost = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL).host
    : process.env.VERCEL_URL || fallbackAppHost;

  return (
    <NetworkCheckClient
      config={{
        anonKeyPrefix: supabaseConfig?.anonKey.slice(0, 12) ?? null,
        appOrigin: `https://${appHost}`,
        requiredBrowserHosts: [appHost, "*.supabase.co", "wss://*.supabase.co", "cdn.plaid.com", "*.plaid.com"],
        supabaseAnonKey: supabaseConfig?.anonKey ?? null,
        supabaseUrl: supabaseConfig?.url ?? null
      }}
    />
  );
}
