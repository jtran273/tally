import { createSupabaseServerClient } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

type SearchParamValue = string | string[] | undefined;

interface LoginPageProps {
  searchParams?: Promise<Record<string, SearchParamValue>>;
}

function firstParam(value: SearchParamValue) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeRedirectPath(value: SearchParamValue) {
  const path = firstParam(value);

  if (!path || !path.startsWith("/") || path.startsWith("//") || path.startsWith("/login")) {
    return "/";
  }

  return path;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {};
  const redirectTo = normalizeRedirectPath(params.redirectedFrom);
  const signedOut = firstParam(params.signedOut) === "1";
  let userEmail: string | null = null;
  let isConfigured = false;

  try {
    const supabase = await createSupabaseServerClient();
    isConfigured = Boolean(supabase);

    if (supabase) {
      const {
        data: { user }
      } = await supabase.auth.getUser();

      userEmail = user?.email ?? null;
    }
  } catch {
    isConfigured = false;
  }

  return (
    <LoginForm
      initialMessage={signedOut ? "Signed out." : null}
      isConfigured={isConfigured}
      redirectTo={redirectTo}
      userEmail={userEmail}
    />
  );
}
