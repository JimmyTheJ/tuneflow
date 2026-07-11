import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PinModal } from "@/components/PinModal";
import { api } from "@/lib/api";
import { getApiUrl, setApiUrl } from "@/lib/settings";
import { useAuthStore } from "@/stores/authStore";
import type { ParentalSettings, ScrobblerConnectionStatus, ScrobblerProviderInfo } from "@/types";

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const isChild = user?.role === "child";
  const isParent = user?.role === "parent";
  const isAdmin = user?.role === "admin";

  const [apiUrl, setApiUrlState] = useState(getApiUrl());
  const [parentPin, setParentPin] = useState("");
  const [hasParentPin, setHasParentPin] = useState(false);
  const [childSettings, setChildSettings] = useState<ParentalSettings | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [scrobblerProviders, setScrobblerProviders] = useState<ScrobblerProviderInfo[]>([]);
  const [scrobblerStatuses, setScrobblerStatuses] = useState<Record<string, ScrobblerConnectionStatus>>({});
  const [pendingLinkTokens, setPendingLinkTokens] = useState<Record<string, string>>({});
  const [scrobblerError, setScrobblerError] = useState<string | null>(null);

  useEffect(() => {
    if (isParent) void api.parentPinStatus().then((s) => setHasParentPin(s.has_pin)).catch(() => undefined);
    if (isChild) void api.getMyChildSettings().then(setChildSettings).catch(() => undefined);
  }, [isChild, isParent]);

  useEffect(() => {
    void (async () => {
      try {
        const providers = await api.listScrobblerProviders();
        setScrobblerProviders(providers);
        const statuses = await Promise.all(providers.map((provider) => api.getScrobblerStatus(provider.id)));
        setScrobblerStatuses(Object.fromEntries(statuses.map((status) => [status.provider, status])));
      } catch {
        /* scrobbling not configured */
      }
    })();
  }, []);

  const refreshScrobblerStatus = async (providerId: string) => {
    const status = await api.getScrobblerStatus(providerId);
    setScrobblerStatuses((current) => ({ ...current, [providerId]: status }));
  };

  const startScrobblerLink = async (providerId: string) => {
    setScrobblerError(null);
    try {
      const link = await api.startScrobblerLink(providerId);
      setPendingLinkTokens((current) => ({ ...current, [providerId]: link.token }));
      window.open(link.authorize_url, "_blank", "noopener,noreferrer");
      setMessage(`Authorize ${providerId} in the new tab, then click Complete link below.`);
    } catch (error) {
      setScrobblerError(error instanceof Error ? error.message : "Could not start scrobbler link");
    }
  };

  const completeScrobblerLink = async (providerId: string) => {
    const token = pendingLinkTokens[providerId];
    if (!token) {
      setScrobblerError("Start linking first so Tuneflow can finish the connection.");
      return;
    }
    setScrobblerError(null);
    try {
      await api.completeScrobblerLink(providerId, token);
      setPendingLinkTokens((current) => {
        const next = { ...current };
        delete next[providerId];
        return next;
      });
      await refreshScrobblerStatus(providerId);
      setMessage("Scrobbler account linked for this profile.");
    } catch (error) {
      setScrobblerError(error instanceof Error ? error.message : "Could not complete scrobbler link");
    }
  };

  const toggleScrobbling = async (providerId: string, enabled: boolean) => {
    setScrobblerError(null);
    try {
      await api.updateScrobblerSettings(providerId, enabled);
      await refreshScrobblerStatus(providerId);
    } catch (error) {
      setScrobblerError(error instanceof Error ? error.message : "Could not update scrobbling settings");
    }
  };

  const unlinkScrobbler = async (providerId: string) => {
    setScrobblerError(null);
    try {
      await api.unlinkScrobbler(providerId);
      await refreshScrobblerStatus(providerId);
      setMessage("Scrobbler account unlinked.");
    } catch (error) {
      setScrobblerError(error instanceof Error ? error.message : "Could not unlink scrobbler account");
    }
  };

  const protectedAction = async (action: "logout" | "switch") => {
    if (!isChild) {
      logout();
      if (action === "switch") navigate("/login");
      return;
    }
    try {
      const { enforced } = await api.parentPinEnforced();
      if (!enforced) {
        logout();
        navigate("/login");
        return;
      }
    } catch {
      /* fall through */
    }
    setPinOpen(true);
  };

  return (
    <div className="page">
      <h1>Settings</h1>
      {user ? (
        <div className="card">
          <p className="label">Signed in as</p>
          <p className="track-title">
            {user.display_name} ({user.role})
          </p>
        </div>
      ) : null}

      {isChild && childSettings ? (
        <div className="card">
          <p className="label">Your limits</p>
          <p className="muted">
            {childSettings.max_daily_minutes != null
              ? `${childSettings.max_daily_minutes} min/day`
              : "No daily limit"}
            {" · "}
            {childSettings.search_enabled ? "Search on" : "Search off"}
          </p>
        </div>
      ) : null}

      <button type="button" className="btn-secondary btn-block" onClick={() => void protectedAction("switch")}>
        Switch account
      </button>
      <button type="button" className="btn-secondary btn-block" onClick={() => void protectedAction("logout")}>
        Sign out
      </button>

      {isAdmin ? (
        <Link to="/admin/cache" className="btn-secondary btn-block link-btn">
          Audio cache management
        </Link>
      ) : null}

      {isParent || isAdmin ? (
        <>
          <Link to="/family" className="btn-secondary btn-block link-btn">
            Family members
          </Link>
          <Link to="/parental" className="btn-secondary btn-block link-btn">
            Parental controls
          </Link>
        </>
      ) : null}

      {isParent ? (
        <>
          <h2>Parent PIN</h2>
          <p className="muted">
            Required for children to switch accounts on a shared device.
            {hasParentPin ? " PIN is set." : " No PIN set yet."}
          </p>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            placeholder="4+ digit PIN"
            value={parentPin}
            onChange={(e) => setParentPin(e.target.value)}
          />
          <button
            type="button"
            className="btn-secondary btn-block"
            onClick={() =>
              void api.setParentPin(parentPin).then(() => {
                setHasParentPin(true);
                setParentPin("");
                setMessage("Parent PIN saved");
              })
            }
          >
            {hasParentPin ? "Update parent PIN" : "Set parent PIN"}
          </button>
        </>
      ) : null}

      {scrobblerProviders.length > 0 ? (
        <>
          <h2>Scrobbling</h2>
          <p className="muted">
            Link a scrobbler account for <strong>{user?.display_name}</strong>. Each family member links their own
            account.
          </p>
          {scrobblerProviders.map((provider) => {
            const status = scrobblerStatuses[provider.id];
            const pendingToken = pendingLinkTokens[provider.id];
            return (
              <div className="card" key={provider.id}>
                <p className="label">{provider.name}</p>
                {status?.linked ? (
                  <>
                    <p className="track-title">Linked as {status.username}</p>
                    <label className="muted">
                      <input
                        type="checkbox"
                        checked={status.scrobbling_enabled}
                        onChange={(e) => void toggleScrobbling(provider.id, e.target.checked)}
                      />{" "}
                      Scrobble plays for this profile
                    </label>
                    <button
                      type="button"
                      className="btn-secondary btn-block"
                      onClick={() => void unlinkScrobbler(provider.id)}
                    >
                      Unlink {provider.name}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="muted">Not linked for this profile.</p>
                    <button
                      type="button"
                      className="btn-primary btn-block"
                      onClick={() => void startScrobblerLink(provider.id)}
                    >
                      Connect {provider.name}
                    </button>
                    {pendingToken ? (
                      <button
                        type="button"
                        className="btn-secondary btn-block"
                        onClick={() => void completeScrobblerLink(provider.id)}
                      >
                        Complete link
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
          {scrobblerError ? <p className="error">{scrobblerError}</p> : null}
        </>
      ) : null}

      {!isChild ? (
        <>
          <h2>Server</h2>
          <p className="muted">API URL for this browser app (default: localhost:8010)</p>
          <input className="input" value={apiUrl} onChange={(e) => setApiUrlState(e.target.value)} />
          <button
            type="button"
            className="btn-primary btn-block"
            onClick={() => {
              setApiUrl(apiUrl);
              setMessage("Server URL saved");
            }}
          >
            Save server URL
          </button>
        </>
      ) : null}

      {message ? <p className="accent">{message}</p> : null}

      <PinModal
        visible={pinOpen}
        title="Parent PIN required"
        message="Enter a parent PIN to continue."
        onVerify={async (pin) => (await api.verifyParentPin(pin)).valid}
        onSuccess={() => {
          setPinOpen(false);
          logout();
          navigate("/login");
        }}
        onCancel={() => setPinOpen(false)}
      />
    </div>
  );
}
