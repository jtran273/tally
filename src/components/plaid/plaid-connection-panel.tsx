"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, Landmark, Plus, RefreshCw, ShieldCheck, Unplug, Wrench, X } from "lucide-react";
import {
  buildPlaidConnectionsStatusSummary,
  formatPlaidSyncResultMessage,
  getPlaidSyncResultErrorDetails,
  type PlaidConnectionIssue
} from "@/lib/plaid/status";
import { useRouter } from "next/navigation";
import {
  usePlaidLink,
  type PlaidLinkError,
  type PlaidLinkOnEventMetadata,
  type PlaidLinkOnExitMetadata,
  type PlaidLinkOnSuccessMetadata
} from "react-plaid-link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./plaid-connection-panel.module.css";

type PlaidEnvironment = "sandbox" | "production";

interface PlaidConnectionSummary {
  autoSyncEnabled: boolean;
  availableProducts: string[];
  billedProducts: string[];
  consentExpiresAt: string | null;
  createdAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  institutionName: string;
  issue: PlaidConnectionIssue | null;
  lastSuccessfulSyncAt: string | null;
  status: "active" | "error" | "revoked";
  updatedAt: string;
}

interface ConnectionsResponse {
  connections: PlaidConnectionSummary[];
  environment: PlaidEnvironment;
}

interface LinkTokenResponse {
  expiration: string;
  linkToken: string;
}

interface ExchangeResponse {
  connection: PlaidConnectionSummary;
  sync: SyncItemSummary | null;
  syncError: string | null;
}

interface SyncItemSummary {
  accountsUpserted: number;
  balanceSnapshotsUpserted: number;
  enrichedTransactionsInserted: number;
  enrichedTransactionsUpdated: number;
  errorCode?: string;
  errorMessage?: string;
  id: string;
  lastSuccessfulSyncAt: string | null;
  rawTransactionsSkipped: number;
  rawTransactionsUpserted: number;
  transactionsRemoved: number;
}

interface SyncRunSummary {
  accountsUpserted: number;
  balanceSnapshotsUpserted: number;
  enrichedTransactionsInserted: number;
  enrichedTransactionsUpdated: number;
  failed: number;
  items: SyncItemSummary[];
  rawTransactionsSkipped: number;
  rawTransactionsUpserted: number;
  runId: string | null;
  source: "initial" | "manual" | "scheduled";
  startedAt: string;
  status: "succeeded" | "partial" | "failed";
  succeeded: number;
  totalItems: number;
  transactionsRemoved: number;
}

interface SyncResponse {
  connections: PlaidConnectionSummary[];
  environment: PlaidEnvironment;
  sync: SyncRunSummary;
}

interface DisconnectResponse {
  connection: PlaidConnectionSummary;
  connections: PlaidConnectionSummary[];
}

type RequestState = "idle" | "loading" | "exchanging" | "syncing";

interface PlaidConnectionPanelProps {
  isDemo?: boolean;
}

interface SyncAttemptState {
  completedAt: string | null;
  errorDetails: string | null;
  message: string;
  startedAt: string;
  status: "pending" | "succeeded" | "partial" | "failed";
}

function formatConnectedDate(value: string) {
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatSyncDate(value: string | null) {
  if (!value) return "Never";

  return new Date(value).toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  });
}

function formatAbsoluteDate(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function formatRelativeTime(value: string | null, now: number | null) {
  if (!value) return "Never";
  if (now === null) return formatAbsoluteDate(value);
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "Never";
  const diffSec = Math.round((time - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 45) return "just now";
  if (abs < 90) return diffSec < 0 ? "1 minute ago" : "in 1 minute";
  const minutes = Math.round(diffSec / 60);
  if (Math.abs(minutes) < 60) return minutes < 0 ? `${-minutes} minutes ago` : `in ${minutes} minutes`;
  const hours = Math.round(diffSec / 3600);
  if (Math.abs(hours) < 24) return hours < 0 ? `${-hours} hours ago` : `in ${hours} hours`;
  const days = Math.round(diffSec / 86400);
  if (Math.abs(days) < 30) return days < 0 ? `${-days} days ago` : `in ${days} days`;
  return formatAbsoluteDate(value);
}

function getEnrichedTransactionCount(summary: SyncItemSummary) {
  return summary.enrichedTransactionsInserted + summary.enrichedTransactionsUpdated;
}

function formatSyncItemMessage(summary: SyncItemSummary) {
  const skipped = summary.rawTransactionsSkipped > 0 ? `, ${summary.rawTransactionsSkipped} skipped` : "";
  return `Sync result: ${summary.accountsUpserted} accounts, ${summary.rawTransactionsUpserted} raw transactions${skipped}, ${getEnrichedTransactionCount(summary)} enriched transactions, 0 failures.`;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : "Plaid request failed.";
    throw new Error(message);
  }

  return body as T;
}

function buildPlaidExitDiagnostic(error: PlaidLinkError | null, metadata: PlaidLinkOnExitMetadata) {
  return {
    displayMessage: error?.display_message || null,
    errorCode: error?.error_code || null,
    errorMessage: error?.error_message || null,
    errorType: error?.error_type || null,
    institutionId: metadata.institution?.institution_id ?? null,
    institutionName: metadata.institution?.name ?? null,
    linkSessionId: metadata.link_session_id || null,
    requestId: metadata.request_id || null,
    status: metadata.status || null
  };
}

function buildPlaidEventDiagnostic(eventName: string, metadata: PlaidLinkOnEventMetadata) {
  return {
    errorCode: metadata.error_code,
    errorMessage: metadata.error_message,
    errorType: metadata.error_type,
    eventName,
    exitStatus: metadata.exit_status,
    institutionId: metadata.institution_id,
    institutionName: metadata.institution_name,
    linkSessionId: metadata.link_session_id,
    requestId: metadata.request_id,
    viewName: metadata.view_name
  };
}

function formatPlaidExitMessage(diagnostic: ReturnType<typeof buildPlaidExitDiagnostic>) {
  const details = [
    diagnostic.errorType ? `type ${diagnostic.errorType}` : null,
    diagnostic.errorCode ? `code ${diagnostic.errorCode}` : null,
    diagnostic.requestId ? `request ${diagnostic.requestId}` : null,
    diagnostic.linkSessionId ? `session ${diagnostic.linkSessionId}` : null,
    diagnostic.institutionName ? `institution ${diagnostic.institutionName}` : null
  ].filter(Boolean);

  return details.length > 0
    ? `Plaid Link closed before the institution was connected. ${details.join("; ")}.`
    : "Plaid Link closed before the institution was connected.";
}

export function PlaidConnectionPanel({ isDemo = false }: PlaidConnectionPanelProps) {
  const router = useRouter();
  const [connections, setConnections] = useState<PlaidConnectionSummary[]>([]);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const openedTokenRef = useRef<string | null>(null);
  const [openRequested, setOpenRequested] = useState(false);
  const [repairConnectionId, setRepairConnectionId] = useState<string | null>(null);
  const [requestState, setRequestState] = useState<RequestState>("loading");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [syncAttempt, setSyncAttempt] = useState<SyncAttemptState | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [autoSyncUpdating, setAutoSyncUpdating] = useState(false);
  const connectButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    const initialId = window.setTimeout(updateNow, 0);
    const intervalId = window.setInterval(updateNow, 30_000);
    return () => {
      window.clearTimeout(initialId);
      window.clearInterval(intervalId);
    };
  }, []);

  const focusConnectButton = useCallback(() => {
    window.requestAnimationFrame(() => connectButtonRef.current?.focus());
  }, []);

  const syncableConnectionCount = useMemo(
    () => connections.filter((connection) => connection.status !== "revoked").length,
    [connections]
  );
  const attentionConnectionCount = useMemo(
    () => connections.filter((connection) =>
      connection.status !== "revoked" && connection.issue && connection.issue.title !== "Never synced"
    ).length,
    [connections]
  );
  const lastSyncAt = useMemo(() => {
    const values = connections
      .filter((connection) => connection.status !== "revoked")
      .map((connection) => connection.lastSuccessfulSyncAt)
      .filter((value): value is string => Boolean(value));

    return values.length > 0
      ? values.sort((a, b) => Date.parse(b) - Date.parse(a))[0]
      : null;
  }, [connections]);
  const statusSummary = useMemo(() => buildPlaidConnectionsStatusSummary(connections), [connections]);
  const autoSyncEnabled = useMemo(
    () => connections.some((connection) => connection.status !== "revoked" && connection.autoSyncEnabled),
    [connections]
  );

  useEffect(() => {
    let ignore = false;

    fetch("/api/plaid/connections", { cache: "no-store" })
      .then((response) =>
        readJson<ConnectionsResponse>(response)
      )
      .then((data) => {
        if (!ignore) {
          setConnections(data.connections);
        }
      })
      .catch((loadError: unknown) => {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load Plaid connections.");
        }
      })
      .finally(() => {
        if (!ignore) setRequestState("idle");
      });

    return () => {
      ignore = true;
    };
  }, []);

  const syncConnections = useCallback(async (connectionId?: string) => {
    const startedAt = new Date().toISOString();
    if (isDemo) {
      setError(null);
      setSuccessMessage("Demo data is read-only. Sign in to sync real bank connections.");
      setSyncAttempt({
        completedAt: startedAt,
        errorDetails: null,
        message: "Demo bank data is static for walkthroughs.",
        startedAt,
        status: "succeeded"
      });
      return;
    }

    setRequestState("syncing");
    setError(null);
    setSuccessMessage(null);
    setSyncAttempt({
      completedAt: null,
      errorDetails: null,
      message: connectionId ? "Syncing this institution now." : "Syncing connected institutions now.",
      startedAt,
      status: "pending"
    });

    try {
      const data = await fetch("/api/plaid/sync", {
        body: connectionId ? JSON.stringify({ connectionId }) : undefined,
        cache: "no-store",
        headers: connectionId ? { "Content-Type": "application/json" } : undefined,
        method: "POST"
      }).then((response) =>
        readJson<SyncResponse>(response)
      );

      setConnections(data.connections);
      const completedAt = new Date().toISOString();
      const message = formatPlaidSyncResultMessage(data.sync);
      const errorDetails = getPlaidSyncResultErrorDetails(data.sync);
      setSyncAttempt({
        completedAt,
        errorDetails,
        message,
        startedAt,
        status: data.sync.status
      });
      if (data.sync.failed > 0) {
        setError(message);
      } else {
        setSuccessMessage(message);
      }
      router.refresh();
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "Unable to sync Plaid data.";
      setSyncAttempt({
        completedAt: new Date().toISOString(),
        errorDetails: null,
        message,
        startedAt,
        status: "failed"
      });
      setError(message);
    } finally {
      setRequestState("idle");
    }
  }, [isDemo, router]);

  const exchangePublicToken = useCallback(async (publicToken: string, metadata: PlaidLinkOnSuccessMetadata) => {
    setRequestState("exchanging");
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await fetch("/api/plaid/exchange", {
        body: JSON.stringify({
          institution: metadata.institution
            ? {
              institutionId: metadata.institution.institution_id,
              name: metadata.institution.name
            }
            : null,
          publicToken
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      }).then((response) => readJson<ExchangeResponse>(response));

      setConnections((current) => [
        data.connection,
        ...current.filter((connection) => connection.id !== data.connection.id)
      ]);
      setSuccessMessage(
        `${data.connection.institutionName} connected.${data.sync ? ` ${formatSyncItemMessage(data.sync)}` : ""}`
      );
      if (data.syncError) setError(data.syncError);
      setLinkToken(null);
      router.refresh();
    } catch (exchangeError) {
      setError(exchangeError instanceof Error ? exchangeError.message : "Unable to finish the Plaid connection.");
    } finally {
      setRequestState("idle");
    }
  }, [router]);

  const { open, ready } = usePlaidLink({
    onEvent: (eventName, metadata) => {
      if (metadata.error_code || eventName === "ERROR") {
        console.warn("Plaid Link event", buildPlaidEventDiagnostic(eventName, metadata));
      }
    },
    onExit: (linkError, metadata) => {
      setOpenRequested(false);
      setRepairConnectionId(null);
      if (linkError) {
        const diagnostic = buildPlaidExitDiagnostic(linkError, metadata);
        console.warn("Plaid Link exited", diagnostic);
        setError(formatPlaidExitMessage(diagnostic));
      }
    },
    onSuccess: (publicToken, metadata) => {
      setOpenRequested(false);
      if (repairConnectionId) {
        const itemId = repairConnectionId;
        setRepairConnectionId(null);
        setSuccessMessage("Plaid repair completed. Syncing the refreshed connection.");
        void syncConnections(itemId);
        return;
      }

      void exchangePublicToken(publicToken, metadata);
    },
    token: linkToken
  });

  useEffect(() => {
    if (!linkToken || !openRequested || !ready || openedTokenRef.current === linkToken) return;

    openedTokenRef.current = linkToken;
    open();
  }, [linkToken, open, openRequested, ready]);

  const startPlaidLink = async (connection?: PlaidConnectionSummary) => {
    setError(null);
    setSuccessMessage(null);

    if (isDemo) {
      setSuccessMessage("Demo mode does not connect banks. Sign in to link a real institution.");
      return;
    }

    if (!connection && linkToken && ready) {
      open();
      return;
    }

    setRequestState("loading");

    try {
      const data = await fetch("/api/plaid/link-token", {
        body: connection ? JSON.stringify({ connectionId: connection.id }) : undefined,
        headers: connection ? { "Content-Type": "application/json" } : undefined,
        method: "POST"
      }).then((response) =>
        readJson<LinkTokenResponse>(response)
      );
      openedTokenRef.current = null;
      setRepairConnectionId(connection?.id ?? null);
      setLinkToken(data.linkToken);
      setOpenRequested(true);
    } catch (tokenError) {
      setRepairConnectionId(null);
      setError(tokenError instanceof Error ? tokenError.message : "Unable to create a Plaid Link token.");
    } finally {
      setRequestState("idle");
    }
  };

  const toggleAutoSync = async (nextValue: boolean) => {
    if (isDemo) {
      setSuccessMessage("Demo mode keeps auto-sync settings read-only.");
      return;
    }

    setAutoSyncUpdating(true);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await fetch(`/api/plaid/connections`, {
        body: JSON.stringify({ autoSyncEnabled: nextValue }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH"
      }).then((response) => readJson<{ autoSyncEnabled: boolean; connections: PlaidConnectionSummary[] }>(response));

      setConnections(data.connections);
      setSuccessMessage(`Daily auto-sync turned ${data.autoSyncEnabled ? "on" : "off"}.`);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Unable to update auto-sync setting.");
    } finally {
      setAutoSyncUpdating(false);
    }
  };

  const disconnectConnection = async (connection: PlaidConnectionSummary) => {
    if (connection.status === "revoked") return;
    if (isDemo) {
      setSuccessMessage("Demo bank connections stay available for the walkthrough.");
      return;
    }

    const confirmed = window.confirm(
      `Disconnect ${connection.institutionName}? Historical transactions will stay in Tally, but future Plaid syncs will stop.`
    );
    if (!confirmed) return;

    setDisconnectingId(connection.id);
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await fetch(`/api/plaid/connections/${connection.id}`, { method: "DELETE" }).then((response) =>
        readJson<DisconnectResponse>(response)
      );

      setConnections(data.connections);
      setSuccessMessage(`${data.connection.institutionName} disconnected. Historical transactions were preserved.`);
      router.refresh();
      focusConnectButton();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Unable to disconnect Plaid institution.");
    } finally {
      setDisconnectingId(null);
    }
  };

  const isBusy = requestState === "loading" || requestState === "exchanging" || openRequested || Boolean(disconnectingId);
  const isSyncing = requestState === "syncing";

  return (
    <section className="settings-panel plaid-panel" id="sync">
      <div className="settings-panel-head">
        <div>
          <div className="card-eyebrow">
            <ShieldCheck size={13} /> Plaid
          </div>
          <div className="settings-title">Bank connections</div>
        </div>
        <div className="plaid-actions">
          <button
            aria-busy={isSyncing}
            aria-label={isSyncing ? "Syncing" : "Sync"}
            className="btn"
            disabled={isDemo || isBusy || isSyncing || syncableConnectionCount === 0}
            onClick={() => void syncConnections()}
            type="button"
          >
            <RefreshCw aria-hidden="true" className={isSyncing ? styles.spin : undefined} size={14} />
            {isDemo ? "Demo" : isSyncing ? "Syncing" : "Sync"}
          </button>
          <button
            aria-busy={requestState === "exchanging" || openRequested}
            aria-label={requestState === "exchanging" ? "Saving Plaid connection" : "Connect a bank with Plaid"}
            className="btn btn-primary"
            disabled={isDemo || isBusy || isSyncing}
            onClick={() => void startPlaidLink()}
            ref={connectButtonRef}
            type="button"
          >
            {requestState === "exchanging" ? <RefreshCw aria-hidden="true" className={styles.spin} size={14} /> : <Plus aria-hidden="true" size={14} />}
            {isDemo ? "Read-only" : requestState === "exchanging" ? "Saving" : "Connect"}
          </button>
        </div>
      </div>

      {isDemo ? (
        <div aria-live="polite" className="plaid-alert warning" role="status">
          <ShieldCheck aria-hidden="true" size={14} />
          <span className={styles.alertBody}>
            Demo mode uses seeded Plaid-style data. Sign in to connect, sync, repair, or disconnect real institutions.
          </span>
        </div>
      ) : null}

      <div className="plaid-sync-summary">
        <span>Last successful sync</span>
        <strong title={lastSyncAt ? formatAbsoluteDate(lastSyncAt) : undefined}>
          {lastSyncAt ? formatRelativeTime(lastSyncAt, now) : "Never"}
        </strong>
      </div>

      <label className="setting-toggle">
        <span className="setting-toggle-copy">
          <span className="settings-row-title">Daily auto-sync</span>
          <span className="settings-row-sub">
            Automatically refresh every bank connection once a day. Turn off to sync only when you click Sync.
          </span>
        </span>
        <span className="switch">
          <input
            aria-label={`Daily auto-sync is ${autoSyncEnabled ? "on" : "off"}`}
            checked={autoSyncEnabled}
            disabled={isDemo || autoSyncUpdating || syncableConnectionCount === 0}
            onChange={(event) => void toggleAutoSync(event.target.checked)}
            type="checkbox"
          />
          <span aria-hidden="true" />
        </span>
      </label>

      {syncAttempt ? (
        <div
          aria-live="polite"
          className={`plaid-alert plaid-sync-attempt ${syncAttempt.status === "pending" ? "warning" : syncAttempt.status === "succeeded" ? "success" : "error"}`}
          role="status"
        >
          {syncAttempt.status === "pending" ? (
            <RefreshCw aria-hidden="true" className={styles.spin} size={14} />
          ) : syncAttempt.status === "succeeded" ? (
            <CheckCircle2 aria-hidden="true" size={14} />
          ) : (
            <AlertCircle aria-hidden="true" size={14} />
          )}
          <span className={styles.alertBody}>
            {syncAttempt.message} Started {formatSyncDate(syncAttempt.startedAt)}
            {syncAttempt.completedAt ? `; completed ${formatSyncDate(syncAttempt.completedAt)}` : ""}.
            {syncAttempt.errorDetails ? ` Latest API detail: ${syncAttempt.errorDetails}` : ""}
          </span>
        </div>
      ) : null}

      {attentionConnectionCount > 0 ? (
        <div aria-live="polite" className="plaid-alert warning" role="status">
          <AlertTriangle aria-hidden="true" size={14} />
          <span className={styles.alertBody}>
            {attentionConnectionCount} connection{attentionConnectionCount === 1 ? "" : "s"} need attention.
            {statusSummary.needsRepair > 0 ? ` ${statusSummary.needsRepair} can be repaired with Plaid update mode.` : ""}
          </span>
        </div>
      ) : null}

      {error ? (
        <div aria-live="assertive" className="plaid-alert error" role="alert">
          <AlertCircle aria-hidden="true" size={14} />
          <span className={styles.alertBody}>{error}</span>
          <button
            aria-label="Dismiss error"
            className={styles.dismiss}
            onClick={() => {
              setError(null);
              focusConnectButton();
            }}
            type="button"
          >
            <X aria-hidden="true" size={12} />
          </button>
        </div>
      ) : null}
      {successMessage ? (
        <div aria-live="polite" className="plaid-alert success" role="status">
          <CheckCircle2 aria-hidden="true" size={14} />
          <span className={styles.alertBody}>{successMessage}</span>
          <button
            aria-label="Dismiss notification"
            className={styles.dismiss}
            onClick={() => {
              setSuccessMessage(null);
              focusConnectButton();
            }}
            type="button"
          >
            <X aria-hidden="true" size={12} />
          </button>
        </div>
      ) : null}

      <div className="plaid-connection-list">
        {requestState === "loading" && connections.length === 0 ? (
          <div className="plaid-empty" aria-busy="true">Loading institutions...</div>
        ) : null}
        {requestState !== "loading" && connections.length === 0 ? (
          <div className={styles.emptyState}>
            <Landmark aria-hidden="true" size={28} />
            <strong>Connect your first bank</strong>
            <p>Link an account with Plaid to import balances, transactions, and recurring payments automatically.</p>
            <button
              aria-busy={requestState === "exchanging" || openRequested}
              className="btn btn-primary"
              disabled={isDemo || isBusy || isSyncing}
              onClick={() => void startPlaidLink()}
              type="button"
            >
              <Plus aria-hidden="true" size={14} />
              {isDemo ? "Read-only demo" : "Connect a bank"}
            </button>
          </div>
        ) : null}
        {connections.map((connection) => {
          const statusLabel =
            connection.status === "active"
              ? "Healthy"
              : connection.status === "error"
                ? "Needs attention"
                : "Disconnected";
          const StatusIcon =
            connection.status === "active" ? CheckCircle2 : connection.status === "error" ? AlertTriangle : Unplug;
          const isDisconnecting = disconnectingId === connection.id;
          const isRepairing = repairConnectionId === connection.id;
          return (
            <div className="plaid-connection-row" key={connection.id}>
              <div className="plaid-connection-icon">
                <Landmark aria-hidden="true" size={16} />
              </div>
              <div className="plaid-connection-copy">
                <div className="settings-row-title">{connection.institutionName}</div>
                <div className="settings-row-sub">
                  Connected <span title={formatAbsoluteDate(connection.createdAt)}>{formatConnectedDate(connection.createdAt)}</span>
                  {" | "}
                  Last sync{" "}
                  <span title={connection.lastSuccessfulSyncAt ? formatAbsoluteDate(connection.lastSuccessfulSyncAt) : "Never"}>
                    {formatRelativeTime(connection.lastSuccessfulSyncAt, now)}
                  </span>
                </div>
                {connection.issue ? (
                  <div className="plaid-issue">
                    <strong>{connection.issue.title}</strong>
                    <span>{connection.issue.detail}</span>
                  </div>
                ) : null}
              </div>
              <span
                aria-label={`Status: ${statusLabel}`}
                className={`plaid-status ${connection.status} ${styles.statusPill}`}
              >
                <StatusIcon aria-hidden="true" size={11} />
                {statusLabel}
              </span>
              {connection.issue?.action === "repair" ? (
                <button
                  aria-busy={isRepairing}
                  className={`btn btn-primary plaid-repair ${styles.repairPrimary}`}
                  disabled={isDemo || isBusy || isSyncing}
                  onClick={() => void startPlaidLink(connection)}
                  type="button"
                >
                  <Wrench aria-hidden="true" className={isRepairing ? styles.spin : undefined} size={14} />
                  {isRepairing ? "Opening" : "Repair"}
                </button>
              ) : null}
              {connection.issue?.action === "reconnect" ? (
                <button
                  aria-busy={requestState === "exchanging" || openRequested}
                  className={`btn btn-primary plaid-repair ${styles.repairPrimary}`}
                  disabled={isDemo || isBusy || isSyncing}
                  onClick={() => void startPlaidLink()}
                  type="button"
                >
                  <Plus aria-hidden="true" size={14} />
                  Reconnect
                </button>
              ) : null}
              {connection.status !== "revoked" ? (
                <button
                  aria-busy={isDisconnecting}
                  aria-label={`Disconnect ${connection.institutionName}`}
                  className="btn btn-danger plaid-disconnect"
                  disabled={isDemo || isBusy || isSyncing}
                  onClick={() => void disconnectConnection(connection)}
                  type="button"
                >
                  <Unplug aria-hidden="true" size={14} />
                  {isDisconnecting ? "Disconnecting" : "Disconnect"}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
