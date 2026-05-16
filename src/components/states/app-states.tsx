"use client";

import { AlertTriangle, LoaderCircle, SearchX } from "lucide-react";

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state-shell state-loading" role="status" aria-live="polite">
      <LoaderCircle className="state-spin" size={20} aria-hidden />
      <div>
        <div className="state-title">{label}</div>
        <div className="state-copy">Opening your workspace.</div>
      </div>
    </div>
  );
}

export function ErrorState({ message, onReset }: { message?: string; onReset?: () => void }) {
  return (
    <div className="state-shell state-error" role="alert">
      <AlertTriangle size={20} aria-hidden />
      <div>
        <div className="state-title">Something went wrong</div>
        <div className="state-copy">{message ?? "Refresh the route and try again."}</div>
        {onReset ? (
          <button className="btn state-action" onClick={onReset} type="button">
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function EmptyState({ label = "Nothing here yet", detail = "Try another route or clear filters." }: { label?: string; detail?: string }) {
  return (
    <div className="state-shell state-empty">
      <SearchX size={20} aria-hidden />
      <div>
        <div className="state-title">{label}</div>
        <div className="state-copy">{detail}</div>
      </div>
    </div>
  );
}
