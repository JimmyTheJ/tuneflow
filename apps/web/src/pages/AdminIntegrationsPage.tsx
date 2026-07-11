import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import type { LlmStatus } from "@/types";
import "./AdminIntegrationsPage.css";

type HealthState = "healthy" | "degraded" | "disabled" | "loading";

function deriveHealth(status: LlmStatus | null, loading: boolean): HealthState {
  if (loading || !status) return "loading";
  if (!status.enabled) return "disabled";
  if (status.configured && status.reachable) return "healthy";
  return "degraded";
}

function healthLabel(state: HealthState): string {
  switch (state) {
    case "healthy":
      return "Healthy";
    case "degraded":
      return "Degraded";
    case "disabled":
      return "Disabled";
    default:
      return "Checking…";
  }
}

function CheckRow({ label, ok, detail }: { label: string; ok: boolean; detail?: string }) {
  return (
    <div className="integration-check">
      <span className={`integration-check-icon ${ok ? "integration-check-ok" : "integration-check-fail"}`}>
        {ok ? "✓" : "✗"}
      </span>
      <div>
        <p className="track-title">{label}</p>
        {detail ? <p className="muted">{detail}</p> : null}
      </div>
    </div>
  );
}

export function AdminIntegrationsPage() {
  const user = useAuthStore((s) => s.user);
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const llmStatus = await api.aiStatus();
      setStatus(llmStatus);
      setLastChecked(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check AI status");
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user?.role !== "admin") return;
    void load();
  }, [load, user?.role]);

  if (user?.role !== "admin") {
    return (
      <div className="page">
        <h1>Integrations</h1>
        <p className="muted">Admin access required.</p>
        <Link to="/settings" className="accent">
          Back to settings
        </Link>
      </div>
    );
  }

  const health = deriveHealth(status, loading);

  return (
    <div className="page">
      <Link to="/settings" className="muted">
        ← Settings
      </Link>
      <h1>Integrations</h1>
      <p className="muted">Server-side integration health for AI features on Discover.</p>

      {error ? <p className="error">{error}</p> : null}

      <div className="card">
        <div className="integration-header">
          <div>
            <p className="label">AI / LLM</p>
            <p className="track-title">OpenAI-compatible provider</p>
          </div>
          <span className={`status-badge integration-health integration-health-${health}`}>
            {healthLabel(health)}
          </span>
        </div>

        {status ? (
          <div className="integration-checks">
            <CheckRow
              label="Enabled in server config"
              ok={status.enabled}
              detail={status.enabled ? "LLM_ENABLED=true" : "Set LLM_ENABLED=true to enable AI features"}
            />
            <CheckRow
              label="Configured"
              ok={status.configured}
              detail={
                status.configured
                  ? `Model: ${status.model}`
                  : "Set LLM_BASE_URL and LLM_MODEL in server environment"
              }
            />
            <CheckRow
              label="Reachable"
              ok={status.reachable}
              detail={
                status.reachable
                  ? `Responding at ${status.base_url}`
                  : status.detail ?? "Could not reach the LLM /models endpoint"
              }
            />
          </div>
        ) : loading ? (
          <p className="muted">Running health check…</p>
        ) : null}

        {status ? (
          <dl className="integration-meta">
            <div>
              <dt>Base URL</dt>
              <dd>{status.base_url}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{status.model}</dd>
            </div>
          </dl>
        ) : null}

        <button type="button" className="btn-secondary btn-block" disabled={loading} onClick={() => void load()}>
          {loading ? "Checking…" : "Re-run health check"}
        </button>

        {lastChecked ? (
          <p className="muted integration-last-checked">Last checked {lastChecked.toLocaleString()}</p>
        ) : null}
      </div>

      <div className="card">
        <p className="label">Setup</p>
        <p className="muted">
          Configure the LLM on the API server via environment variables: <code>LLM_ENABLED</code>,{" "}
          <code>LLM_BASE_URL</code>, <code>LLM_MODEL</code>, and optionally <code>LLM_API_KEY</code>. Compatible
          with Ollama, LM Studio, OpenAI, and other OpenAI-compatible APIs.
        </p>
      </div>
    </div>
  );
}
