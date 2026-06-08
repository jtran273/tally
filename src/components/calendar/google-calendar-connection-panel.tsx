"use client";

import { AlertCircle, CalendarDays, CheckCircle2, Plus, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

interface GoogleCalendarConnectionSummary {
  calendarSummary: string | null;
  createdAt: string;
  errorCode: string | null;
  errorMessage: string | null;
  id: string;
  lastSuccessfulSyncAt: string | null;
  status: "active" | "error" | "revoked";
  updatedAt: string;
}

interface ConnectionsResponse {
  connections: GoogleCalendarConnectionSummary[];
}

interface AuthUrlResponse {
  authUrl: string;
}

interface DisconnectResponse {
  connection: GoogleCalendarConnectionSummary;
  connections: GoogleCalendarConnectionSummary[];
}

interface RefreshResponse {
  connection: GoogleCalendarConnectionSummary | null;
  connections: GoogleCalendarConnectionSummary[];
  eventCount: number;
}

type RequestState = "idle" | "loading" | "connecting" | "disconnecting" | "refreshing";

interface GoogleCalendarConnectionPanelProps {
  initialError?: string | null;
  initialSuccessMessage?: string | null;
  isDemo?: boolean;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof body.error === "string" ? body.error : "Google Calendar request failed.";
    throw new Error(message);
  }

  return body as T;
}

function formatDate(value: string | null) {
  if (!value) return "Never";

  return new Date(value).toLocaleString("en-US", {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short"
  });
}

export function GoogleCalendarConnectionPanel({
  initialError = null,
  initialSuccessMessage = null,
  isDemo = false
}: GoogleCalendarConnectionPanelProps) {
  const router = useRouter();
  const [connections, setConnections] = useState<GoogleCalendarConnectionSummary[]>([]);
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [requestState, setRequestState] = useState<RequestState>("loading");
  const [successMessage, setSuccessMessage] = useState<string | null>(initialSuccessMessage);

  const activeConnection = useMemo(
    () => connections.find((connection) => connection.status === "active") ?? null,
    [connections]
  );
  const lastReadAt = activeConnection?.lastSuccessfulSyncAt ?? null;

  const loadConnections = useCallback(async () => {
    setRequestState("loading");
    try {
      const data = await fetch("/api/calendar/connections", { cache: "no-store" })
        .then((response) => readJson<ConnectionsResponse>(response));
      setConnections(data.connections);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load Google Calendar connections.");
    } finally {
      setRequestState("idle");
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    fetch("/api/calendar/connections", { cache: "no-store" })
      .then((response) => readJson<ConnectionsResponse>(response))
      .then((data) => {
        if (!ignore) setConnections(data.connections);
      })
      .catch((loadError: unknown) => {
        if (!ignore) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load Google Calendar connections.");
        }
      })
      .finally(() => {
        if (!ignore) setRequestState("idle");
      });

    return () => {
      ignore = true;
    };
  }, []);

  const startConnection = async () => {
    setError(null);
    setSuccessMessage(null);
    if (isDemo) {
      setSuccessMessage("Demo mode does not connect Google Calendar. Sign in to enable real calendar context.");
      return;
    }

    setRequestState("connecting");

    try {
      const data = await fetch("/api/calendar/auth-url", {
        cache: "no-store",
        method: "POST"
      }).then((response) => readJson<AuthUrlResponse>(response));

      window.location.assign(data.authUrl);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Unable to start Google Calendar connection.");
      setRequestState("idle");
    }
  };

  const disconnectConnection = async (connection: GoogleCalendarConnectionSummary) => {
    if (connection.status === "revoked") return;
    if (isDemo) {
      setSuccessMessage("Demo calendar context is read-only.");
      return;
    }

    const confirmed = window.confirm("Disconnect Google Calendar? Tally will stop reading upcoming events for OpenClaw planning context.");
    if (!confirmed) return;

    setDisconnectingId(connection.id);
    setRequestState("disconnecting");
    setError(null);
    setSuccessMessage(null);

    try {
      const data = await fetch(`/api/calendar/connections/${connection.id}`, { method: "DELETE" })
        .then((response) => readJson<DisconnectResponse>(response));
      setConnections(data.connections);
      setSuccessMessage("Google Calendar disconnected.");
      router.refresh();
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : "Unable to disconnect Google Calendar.");
    } finally {
      setDisconnectingId(null);
      setRequestState("idle");
    }
  };

  const refreshCalendar = async () => {
    setError(null);
    setSuccessMessage(null);
    if (isDemo) {
      setSuccessMessage("Demo calendar context is read-only.");
      return;
    }

    setRequestState("refreshing");

    try {
      const data = await fetch("/api/calendar/refresh", {
        cache: "no-store",
        method: "POST"
      }).then((response) => readJson<RefreshResponse>(response));
      setConnections(data.connections);
      setSuccessMessage(
        data.connection
          ? `Google Calendar refreshed. Read ${data.eventCount} upcoming ${data.eventCount === 1 ? "event" : "events"}.`
          : "No Google Calendar connected."
      );
      router.refresh();
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh Google Calendar.");
    } finally {
      setRequestState("idle");
    }
  };

  const isBusy =
    requestState === "loading" ||
    requestState === "connecting" ||
    requestState === "disconnecting" ||
    requestState === "refreshing";

  return (
    <section className="settings-panel calendar-panel">
      <div className="settings-panel-head">
        <div>
          <div className="card-eyebrow">
            <ShieldCheck size={13} /> Google Calendar
          </div>
          <div className="settings-title">Calendar context</div>
        </div>
        <div className="calendar-actions">
          <button className="btn" disabled={isBusy} onClick={() => void refreshCalendar()} type="button">
            <RefreshCw size={14} />
            {requestState === "refreshing" ? "Refreshing" : "Refresh"}
          </button>
          <button className="btn btn-primary" disabled={isDemo || isBusy} onClick={() => void startConnection()} type="button">
            {requestState === "connecting" ? <RefreshCw size={14} /> : <Plus size={14} />}
            {isDemo ? "Read-only" : activeConnection ? "Reconnect" : "Connect"}
          </button>
        </div>
      </div>

      {isDemo ? (
        <div className="plaid-alert warning" role="status">
          <ShieldCheck size={14} />
          <span>Demo mode keeps calendar integration off. Sign in to connect Google Calendar.</span>
        </div>
      ) : null}

      <div className="plaid-sync-summary">
        <span>Last calendar read</span>
        <strong>{formatDate(lastReadAt)}</strong>
      </div>

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
          <div className="plaid-empty">Loading calendar connection...</div>
        ) : null}
        {requestState !== "loading" && connections.length === 0 ? (
          <div className="plaid-empty">No Google Calendar connected.</div>
        ) : null}
        {connections.map((connection) => (
          <div className="plaid-connection-row" key={connection.id}>
            <div className="plaid-connection-icon">
              <CalendarDays size={16} />
            </div>
            <div className="plaid-connection-copy">
              <div className="settings-row-title">{connection.calendarSummary ?? "Primary calendar"}</div>
              <div className="settings-row-sub">
                Connected {formatDate(connection.createdAt)}
                {" | "}
                Last read {formatDate(connection.lastSuccessfulSyncAt)}
              </div>
              {connection.errorMessage ? (
                <div className="plaid-issue">
                  <strong>Read issue</strong>
                  <span>{connection.errorMessage}</span>
                </div>
              ) : null}
            </div>
            <span className={`plaid-status ${connection.status}`}>{connection.status}</span>
            {connection.status !== "revoked" ? (
              <button
                className="btn btn-danger plaid-disconnect"
                disabled={isDemo || isBusy}
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
