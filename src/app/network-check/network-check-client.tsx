"use client";

import { useMemo, useState } from "react";
import styles from "./network-check.module.css";

type CheckStatus = "idle" | "checking" | "ok" | "blocked";

interface CheckResult {
  detail: string;
  elapsedMs?: number;
  status: CheckStatus;
}

interface NetworkCheckConfig {
  anonKeyPrefix: string | null;
  appOrigin: string;
  requiredBrowserHosts: string[];
  supabaseAnonKey: string | null;
  supabaseUrl: string | null;
}

type CheckKey = "app" | "supabaseAuth" | "supabaseRest" | "supabaseRealtime" | "plaidCdn";

const labels: Record<CheckKey, string> = {
  app: "Tally app",
  plaidCdn: "Plaid CDN",
  supabaseAuth: "Supabase Auth",
  supabaseRealtime: "Supabase realtime",
  supabaseRest: "Supabase REST"
};

function timeoutSignal(timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    stop() {
      window.clearTimeout(timeout);
    }
  };
}

async function timed(label: string, run: () => Promise<string>): Promise<CheckResult> {
  const started = performance.now();

  try {
    const detail = await run();
    return {
      detail,
      elapsedMs: Math.round(performance.now() - started),
      status: "ok"
    };
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : `${label} could not be reached.`,
      elapsedMs: Math.round(performance.now() - started),
      status: "blocked"
    };
  }
}

async function fetchWithTimeout(url: string, init?: RequestInit) {
  const timeout = timeoutSignal(7000);

  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: timeout.signal
    });
  } finally {
    timeout.stop();
  }
}

function loadScriptWithTimeout(src: string) {
  return new Promise<string>((resolve, reject) => {
    const script = document.createElement("script");
    const timeout = window.setTimeout(() => {
      script.remove();
      reject(new Error("Timed out loading Plaid script."));
    }, 7000);

    script.async = true;
    script.src = src;
    script.onload = () => {
      window.clearTimeout(timeout);
      script.remove();
      resolve("Script loaded.");
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      script.remove();
      reject(new Error("Browser blocked or failed the Plaid script request."));
    };
    document.head.append(script);
  });
}

function openSupabaseRealtimeSocket(supabaseUrl: string, anonKey: string) {
  return new Promise<string>((resolve, reject) => {
    const realtimeUrl = new URL(supabaseUrl);
    realtimeUrl.protocol = realtimeUrl.protocol === "https:" ? "wss:" : "ws:";
    realtimeUrl.pathname = "/realtime/v1/websocket";
    realtimeUrl.searchParams.set("apikey", anonKey);
    realtimeUrl.searchParams.set("vsn", "1.0.0");

    const socket = new WebSocket(realtimeUrl);
    const timeout = window.setTimeout(() => {
      socket.close();
      reject(new Error("Timed out opening Supabase WebSocket."));
    }, 7000);

    socket.onopen = () => {
      window.clearTimeout(timeout);
      socket.close();
      resolve("WebSocket opened.");
    };
    socket.onerror = () => {
      window.clearTimeout(timeout);
      socket.close();
      reject(new Error("Browser blocked or failed the Supabase WebSocket."));
    };
  });
}

function statusCopy(result: CheckResult) {
  if (result.status === "checking") return "Checking";
  if (result.status === "ok") return `OK${typeof result.elapsedMs === "number" ? ` in ${result.elapsedMs}ms` : ""}`;
  if (result.status === "blocked") {
    return `Blocked${typeof result.elapsedMs === "number" ? ` after ${result.elapsedMs}ms` : ""}`;
  }
  return "Not run";
}

export function NetworkCheckClient({ config }: { config: NetworkCheckConfig }) {
  const [results, setResults] = useState<Record<CheckKey, CheckResult>>({
    app: { detail: "Waiting to run.", status: "idle" },
    plaidCdn: { detail: "Waiting to run.", status: "idle" },
    supabaseAuth: { detail: "Waiting to run.", status: "idle" },
    supabaseRealtime: { detail: "Waiting to run.", status: "idle" },
    supabaseRest: { detail: "Waiting to run.", status: "idle" }
  });
  const [isRunning, setIsRunning] = useState(false);

  const hasBlocked = useMemo(
    () => Object.values(results).some((result) => result.status === "blocked"),
    [results]
  );

  async function runChecks() {
    setIsRunning(true);
    setResults((current) =>
      Object.fromEntries(
        Object.entries(current).map(([key]) => [key, { detail: "Checking...", status: "checking" }])
      ) as Record<CheckKey, CheckResult>
    );

    const checks: Array<[CheckKey, Promise<CheckResult>]> = [
      [
        "app",
        timed("Tally app", async () => {
          const response = await fetchWithTimeout("/api/network-check");
          if (!response.ok) throw new Error(`Same-origin API returned HTTP ${response.status}.`);
          return "Same-origin API reachable.";
        })
      ],
      [
        "plaidCdn",
        timed("Plaid CDN", () => loadScriptWithTimeout("https://cdn.plaid.com/link/v2/stable/link-initialize.js"))
      ],
      [
        "supabaseAuth",
        timed("Supabase Auth", async () => {
          if (!config.supabaseUrl || !config.supabaseAnonKey) return "Supabase is not configured.";
          const response = await fetchWithTimeout(`${config.supabaseUrl}/auth/v1/settings`, {
            headers: {
              apikey: config.supabaseAnonKey
            }
          });
          if (!response.ok) throw new Error(`Supabase Auth returned HTTP ${response.status}.`);
          return "Auth settings reachable.";
        })
      ],
      [
        "supabaseRest",
        timed("Supabase REST", async () => {
          if (!config.supabaseUrl || !config.supabaseAnonKey) return "Supabase is not configured.";
          const response = await fetchWithTimeout(`${config.supabaseUrl}/rest/v1/`, {
            headers: {
              apikey: config.supabaseAnonKey
            }
          });
          if (!response.ok && response.status !== 404) {
            throw new Error(`Supabase REST returned HTTP ${response.status}.`);
          }
          return "REST gateway reachable.";
        })
      ],
      [
        "supabaseRealtime",
        timed("Supabase realtime", async () => {
          if (!config.supabaseUrl || !config.supabaseAnonKey) return "Supabase is not configured.";
          return openSupabaseRealtimeSocket(config.supabaseUrl, config.supabaseAnonKey);
        })
      ]
    ];

    const settled = await Promise.all(checks.map(async ([key, promise]) => [key, await promise] as const));
    setResults(Object.fromEntries(settled) as Record<CheckKey, CheckResult>);
    setIsRunning(false);
  }

  return (
    <main className={styles.shell}>
      <section className={styles.hero} aria-labelledby="network-check-title">
        <div>
          <p className={styles.eyebrow}>Connectivity diagnostic</p>
          <h1 id="network-check-title">Tally network check</h1>
          <p>
            Run this on Microsoft, school, airport, or corporate Wi-Fi to see whether the network can reach the
            browser services Tally needs.
          </p>
        </div>
        <button className={styles.primaryButton} disabled={isRunning} onClick={runChecks} type="button">
          {isRunning ? "Checking..." : "Run checks"}
        </button>
      </section>

      {hasBlocked ? (
        <section className={styles.notice} aria-live="polite">
          <strong>Something is blocked.</strong>
          <span>Try another network or ask IT to allow the blocked host family below.</span>
        </section>
      ) : null}

      <section className={styles.grid} aria-label="Network checks">
        {(Object.keys(labels) as CheckKey[]).map((key) => {
          const result = results[key];
          return (
            <article className={`${styles.card} ${styles[result.status]}`} key={key}>
              <div className={styles.cardHeader}>
                <h2>{labels[key]}</h2>
                <span>{statusCopy(result)}</span>
              </div>
              <p>{result.detail}</p>
            </article>
          );
        })}
      </section>

      <section className={styles.hosts} aria-label="Required hosts">
        <h2>Hosts to allow</h2>
        <ul>
          {config.requiredBrowserHosts.map((host) => (
            <li key={host}>{host}</li>
          ))}
        </ul>
        {config.supabaseUrl ? <p>Configured Supabase project: {config.supabaseUrl}</p> : null}
        {config.anonKeyPrefix ? <p>Public anon key prefix: {config.anonKeyPrefix}...</p> : null}
      </section>
    </main>
  );
}
