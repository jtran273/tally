"use client";

import { AlertCircle, AlertTriangle, CheckCircle2, Landmark, Plus, RefreshCw, ShieldCheck, Unplug, Wrench } from "lucide-react";
import { buildPlaidConnectionsStatusSummary, type PlaidConnectionIssue } from "@/lib/plaid/status";
import { usePlaidLink, type PlaidLinkOnSuccessMetadata } from "react-plaid-link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type PlaidEnvironment = "sandbox" | "production";

interface PlaidConnectionSummary {
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
  plaidInstitutionId: string | null;
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
  rawTransactionsSkipped: number;
  rawTransactionsUpserted: number;
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

function formatEnvironment(environment: PlaidEnvironment) {
  return environment === "production" ? "Production" : "Sandbox";
}

function getEnrichedTransactionCount(summary: SyncItemSummary | SyncRunSummary) {
  return summary.enrichedTransactionsInserted + summary.enrichedTransactionsUpdated;
}

function formatSyncItemMessage(summary: SyncItemSummary) {
  return `Sync result: ${summary.accountsUpserted} accounts, ${summary.rawTransactionsUpserted} raw transactions, ${getEnrichedTransactionCount(summary)} enriched transactions, 0 failures.`;
}

function formatSyncRunMessage(summary: SyncRunSummary) {
  return `Sync result: ${summary.accountsUpserted} accounts, ${summary.rawTransactionsUpserted} raw transactions, ${getEnrichedTransactionCount(summary)} enriched transactions, ${summary.failed} failures.`;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : "Plaid request failed.";
    throw new Error(message);
  }

  return body as T;
}

export function PlaidConnectionPanel() {
  const [connections, setConnections] = useState<PlaidConnectionSummary[]>([]);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<PlaidEnvironment>("sandbox");
  const [error, setError] = useState<string | null>(null);
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const openedTokenRef = useRef<string | null>(null);
  const [openRequested, setOpenRequested] = useState(false);
  const [repairConnectionId, setRepairConnectionId] = useState<string | null>(null);
  const [requestState, setRequestState] = useState<RequestState>("loading");
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const connectedInstitutionCount = useMemo(
    () => new Set(connections.map((connection) => connection.plaidInstitutionId ?? connection.institutionName)).size,
    [connections]
  );
  const syncableConnectionCount = useMemo(
    () => connections.filter((connection) => connection.status !== "revoked").length,
    [connections]
  );
  const lastSyncAt = useMemo(() => {
    const values = connections
      .map((connection) => connection.lastSuccessfulSyncAt)
      .filter((value): value is string => Boolean(value));

    return values.length > 0
      ? values.sort((a, b) => Date.parse(b) - Date.parse(a))[0]
      : null;
  }, [connections]);
  const statusSummary = useMemo(() => buildPlaidConnectionsStatusSummary(connections), [connections]);

  useEffect(() => {
    let ignore = false;

    fetch("/api/plaid/connections", { cache: "no-store" })
      .then((response) =>
        readJson<ConnectionsResponse>(response)
      )
      .then((data) => {
        if (!ignore) {
          setConnections(data.connections);
          setEnvironment(data.environment);
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
    setRequestState("syncing");
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await fetch("/api/plaid/sync", {
        body: connectionId ? JSON.stringify({ connectionId }) : undefined,
        headers: connectionId ? { "Content-Type": "application/json" } : undefined,
        method: "POST"
      }).then((response) =>
        readJson<SyncResponse>(response)
      );

      setConnections(data.connections);
      setEnvironment(data.environment);
      const message = formatSyncRunMessage(data.sync);
      if (data.sync.failed > 0) {
        setError(`Sync incomplete. ${message}`);
      } else {
        setSuccessMessage(message);
      }
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Unable to sync Plaid data.");
    } finally {
      setRequestState("idle");
    }
  }, []);

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
    } catch (exchangeError) {
      setError(exchangeError instanceof Error ? exchangeError.message : "Unable to finish the Plaid connection.");
    } finally {
      setRequestState("idle");
    }
  }, []);

  const { open, ready } = usePlaidLink({
    onExit: (linkError) => {
      setOpenRequested(false);
      setRepairConnectionId(null);
      if (linkError) {
        setError("Plaid Link closed before the institution was connected.");
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

  const disconnectConnection = async (connection: PlaidConnectionSummary) => {
    if (connection.status === "revoked") return;

    const confirmed = window.confirm(
      `Disconnect ${connection.institutionName}? Historical transactions will stay in the app, but future Plaid syncs will stop.`
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
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Unable to disconnect Plaid institution.");
    } finally {
      setDisconnectingId(null);
    }
  };

  const isBusy = requestState === "loading" || requestState === "exchanging" || openRequested || Boolean(disconnectingId);
  const isSyncing = requestState === "syncing";
  const environmentLabel = formatEnvironment(environment);

  return (
    <section className="settings-panel plaid-panel">
      <div className="settings-panel-head">
        <div>
          <div className="card-eyebrow">
            <ShieldCheck size={13} /> Plaid {environmentLabel}
          </div>
          <div className="settings-title">Bank connections</div>
        </div>
        <div className="plaid-actions">
          <button
            className="btn"
            disabled={isBusy || isSyncing || syncableConnectionCount === 0}
            onClick={() => void syncConnections()}
            type="button"
          >
            <RefreshCw size={14} />
            {isSyncing ? "Syncing" : "Sync"}
          </button>
          <button className="btn btn-primary" disabled={isBusy || isSyncing} onClick={() => void startPlaidLink()} type="button">
            {requestState === "exchanging" ? <RefreshCw size={14} /> : <Plus size={14} />}
            {requestState === "exchanging" ? "Saving" : "Connect"}
          </button>
        </div>
      </div>

      <div className="plaid-metrics">
        <div className="setting-metric">
          <div className="setting-metric-value">{environmentLabel}</div>
          <div className="settings-row-sub">Environment</div>
        </div>
        <div className="setting-metric">
          <div className="setting-metric-value">{statusSummary.syncable}</div>
          <div className="settings-row-sub">Items</div>
        </div>
        <div className="setting-metric">
          <div className="setting-metric-value">{connectedInstitutionCount}</div>
          <div className="settings-row-sub">Institutions</div>
        </div>
        <div className="setting-metric">
          <div className="setting-metric-value sync-date">{formatSyncDate(lastSyncAt)}</div>
          <div className="settings-row-sub">Last sync</div>
        </div>
      </div>

      {environment === "production" ? (
        <div className="plaid-alert warning">
          <AlertTriangle size={14} />
          <span>Production mode imports real account balances and transactions from connected institutions.</span>
        </div>
      ) : null}

      {statusSummary.status === "needs_attention" ? (
        <div className="plaid-alert warning">
          <AlertTriangle size={14} />
          <span>
            {statusSummary.errored} connection{statusSummary.errored === 1 ? "" : "s"} need attention.
            {statusSummary.needsRepair > 0 ? ` ${statusSummary.needsRepair} can be repaired with Plaid update mode.` : ""}
          </span>
        </div>
      ) : null}

      {error ? (
        <div className="plaid-alert error">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      ) : null}
      {successMessage ? (
        <div className="plaid-alert success">
          <CheckCircle2 size={14} />
          <span>{successMessage}</span>
        </div>
      ) : null}

      <div className="plaid-connection-list">
        {requestState === "loading" && connections.length === 0 ? (
          <div className="plaid-empty">Loading institutions...</div>
        ) : null}
        {requestState !== "loading" && connections.length === 0 ? (
          <div className="plaid-empty">No Plaid institutions connected.</div>
        ) : null}
        {connections.map((connection) => (
          <div className="plaid-connection-row" key={connection.id}>
            <div className="plaid-connection-icon">
              <Landmark size={16} />
            </div>
            <div className="plaid-connection-copy">
              <div className="settings-row-title">{connection.institutionName}</div>
              <div className="settings-row-sub">
                Connected {formatConnectedDate(connection.createdAt)}
                {" | "}
                Last sync {formatSyncDate(connection.lastSuccessfulSyncAt)}
              </div>
              {connection.issue ? (
                <div className="plaid-issue">
                  <strong>{connection.issue.title}</strong>
                  <span>{connection.issue.detail}</span>
                </div>
              ) : null}
            </div>
            <span className={`plaid-status ${connection.status}`}>{connection.status}</span>
            {connection.issue?.action === "repair" ? (
              <button
                className="btn plaid-repair"
                disabled={isBusy || isSyncing}
                onClick={() => void startPlaidLink(connection)}
                type="button"
              >
                <Wrench size={14} />
                {repairConnectionId === connection.id ? "Opening" : "Repair"}
              </button>
            ) : null}
            {connection.status !== "revoked" ? (
              <button
                className="btn btn-danger plaid-disconnect"
                disabled={isBusy || isSyncing}
                onClick={() => void disconnectConnection(connection)}
                type="button"
              >
                <Unplug size={14} />
                {disconnectingId === connection.id ? "Disconnecting" : "Disconnect"}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
