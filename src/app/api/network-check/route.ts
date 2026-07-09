import { getSupabaseConfig } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export function GET() {
  const supabaseConfig = getSupabaseConfig();

  return Response.json(
    {
      checkedAt: new Date().toISOString(),
      requiredBrowserHosts: [
        "personal-finance-os-lac.vercel.app",
        "*.supabase.co",
        "wss://*.supabase.co",
        "cdn.plaid.com",
        "*.plaid.com"
      ],
      supabase: supabaseConfig
        ? {
            anonKeyPrefix: supabaseConfig.anonKey.slice(0, 12),
            configured: true,
            url: supabaseConfig.url
          }
        : {
            anonKeyPrefix: null,
            configured: false,
            url: null
          }
    },
    {
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
