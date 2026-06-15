"use client";

import { TallyMark } from "@/components/brand/tally-mark";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { type SupabaseConfig } from "@/lib/supabase/env";
import { ArrowRight, FlaskConical, LogIn, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import styles from "./login.module.css";

interface LoginFormProps {
  initialMessage: string | null;
  isDemoAvailable: boolean;
  redirectTo: string;
  supabaseConfig: SupabaseConfig | null;
  userEmail: string | null;
}

type AuthStatus = {
  message: string;
  tone: "error" | "success";
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to complete authentication.";
}

export function LoginForm({ initialMessage, isDemoAvailable, redirectTo, supabaseConfig, userEmail }: LoginFormProps) {
  const router = useRouter();
  const isConfigured = Boolean(supabaseConfig);
  const [status, setStatus] = useState<AuthStatus | null>(
    initialMessage ? { message: initialMessage, tone: "success" } : null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabaseConfig) {
      setStatus({
        message:
          "Supabase Auth is not configured. Set NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY/SUPABASE_ANON_KEY.",
        tone: "error"
      });
      return;
    }

    setIsSubmitting(true);
    setStatus(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!email || !password) {
      setStatus({ message: "Enter an email and password.", tone: "error" });
      setIsSubmitting(false);
      return;
    }

    try {
      const supabase = createSupabaseBrowserClient(supabaseConfig);
      const { error } = await supabase.auth.signInWithPassword({ email, password });

      if (error) {
        setStatus({ message: error.message, tone: "error" });
        return;
      }

      router.push(redirectTo);
      router.refresh();
    } catch (error) {
      setStatus({ message: getErrorMessage(error), tone: "error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="login-title">
        <div className={styles.brand}>
          <div className={styles.mark}><TallyMark aria-hidden /></div>
          <div>
            <div className={styles.name}>Tally</div>
            <div className={styles.sub}>Personal finance copilot</div>
          </div>
        </div>

        {userEmail ? (
          <div className={styles.stack}>
            <div className={styles.iconWrap}>
              <ShieldCheck size={22} aria-hidden />
            </div>
            <div>
              <p className={styles.eyebrow}>Authenticated</p>
              <h1 id="login-title" className={styles.title}>Signed in</h1>
              <p className={styles.copy}>{userEmail}</p>
            </div>

            {status ? <p className={`${styles.notice} ${styles[status.tone]}`}>{status.message}</p> : null}

            <div className={styles.actions}>
              <Link className={styles.primaryLink} href={redirectTo}>
                Continue <ArrowRight size={16} aria-hidden />
              </Link>
              <form action="/login/logout" method="post">
                <button className={styles.secondaryButton} type="submit">
                  <LogOut size={16} aria-hidden /> Sign out
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className={styles.stack}>
            <form className={styles.stack} onSubmit={handleSignIn}>
              <div>
                <p className={styles.eyebrow}>Supabase Auth</p>
                <h1 id="login-title" className={styles.title}>Sign in to Tally</h1>
              </div>

              {!isConfigured ? (
                <p className={`${styles.notice} ${styles.error}`}>
                  Supabase Auth is not configured. Set the public Supabase URL and anon key in your environment.
                </p>
              ) : null}
              {status ? <p className={`${styles.notice} ${styles[status.tone]}`}>{status.message}</p> : null}

              <label className={styles.field}>
                <span>Email</span>
                <input autoComplete="email" name="email" placeholder="you@example.com" type="email" />
              </label>

              <label className={styles.field}>
                <span>Password</span>
                <input autoComplete="current-password" name="password" placeholder="Password" type="password" />
              </label>

              <button className={styles.primaryButton} disabled={isSubmitting || !isConfigured} type="submit">
                <LogIn size={16} aria-hidden />
                {isSubmitting ? "Signing in..." : "Sign in"}
              </button>
            </form>

            {isDemoAvailable ? (
              <form action="/login/demo" className={styles.demoBlock} method="post">
                <div>
                  <p className={styles.demoTitle}>Need test data?</p>
                  <p className={styles.demoCopy}>Open a seeded demo workspace without Supabase or Plaid.</p>
                </div>
                <input name="redirectTo" type="hidden" value={redirectTo} />
                <button className={styles.demoButton} type="submit">
                  <FlaskConical size={16} aria-hidden />
                  Enter demo
                </button>
              </form>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
