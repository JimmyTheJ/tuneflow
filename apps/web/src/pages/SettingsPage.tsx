import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PinModal } from "@/components/PinModal";
import { api } from "@/lib/api";
import {
  canManageMembers,
  canManageParentalControls,
  canManageRoleProfiles,
  canSetParentPin,
  formatRoleProfiles,
  isChildProfile,
} from "@/lib/permissions";
import { getApiUrl, setApiUrl } from "@/lib/settings";
import { useAuthStore } from "@/stores/authStore";
import type { ParentalSettings, ScrobblerConnectionStatus, ScrobblerProviderInfo } from "@/types";

export function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const hydrate = useAuthStore((s) => s.hydrate);
  const navigate = useNavigate();
  const isChild = isChildProfile(user);
  const isRootAdmin = user?.is_root_admin === true;

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
  const [householdSlug, setHouseholdSlug] = useState("");
  const [householdSlugMessage, setHouseholdSlugMessage] = useState<string | null>(null);
  const [householdSlugError, setHouseholdSlugError] = useState<string | null>(null);
  const [householdSlugBusy, setHouseholdSlugBusy] = useState(false);

  const isHouseholdAdmin = canManageRoleProfiles(user) && !isRootAdmin;

  useEffect(() => {
    if (!isHouseholdAdmin) return;
    void api
      .getMyHousehold()
      .then((household) => setHouseholdSlug(household.slug))
      .catch(() => undefined);
  }, [isHouseholdAdmin]);

  useEffect(() => {
    if (canSetParentPin(user)) {
      void api.parentPinStatus().then((s) => setHasParentPin(s.has_pin)).catch(() => undefined);
    }
    if (isChild) void api.getMyChildSettings().then(setChildSettings).catch(() => undefined);
  }, [isChild, user]);

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
    } catch (linkError) {
      setScrobblerError(linkError instanceof Error ? linkError.message : "Could not start scrobbler link");
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
    } catch (linkError) {
      setScrobblerError(linkError instanceof Error ? linkError.message : "Could not complete scrobbler link");
    }
  };

  const toggleScrobbling = async (providerId: string, enabled: boolean) => {
    setScrobblerError(null);
    try {
      await api.updateScrobblerSettings(providerId, enabled);
      await refreshScrobblerStatus(providerId);
    } catch (linkError) {
      setScrobblerError(linkError instanceof Error ? linkError.message : "Could not update scrobbling settings");
    }
  };

  const unlinkScrobbler = async (providerId: string) => {
    setScrobblerError(null);
    try {
      await api.unlinkScrobbler(providerId);
      await refreshScrobblerStatus(providerId);
      setMessage("Scrobbler account unlinked.");
    } catch (linkError) {
      setScrobblerError(linkError instanceof Error ? linkError.message : "Could not unlink scrobbler account");
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

  const saveHouseholdSlug = async () => {
    setHouseholdSlugBusy(true);
    setHouseholdSlugError(null);
    setHouseholdSlugMessage(null);
    try {
      const household = await api.updateMyHousehold({ slug: householdSlug.trim().toLowerCase() });
      setHouseholdSlug(household.slug);
      setHouseholdSlugMessage("Household slug updated. Share the new login URL with your household.");
      await hydrate();
    } catch (err) {
      setHouseholdSlugError(err instanceof Error ? err.message : "Could not update household slug");
    } finally {
      setHouseholdSlugBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>Settings</h1>
      {user ? (
        <div className="card">
          <p className="label">Signed in as</p>
          <p className="track-title">
            {user.display_name}
            {user.household_name ? ` · ${user.household_name}` : ""}
          </p>
          <p className="muted">
            {formatRoleProfiles(user.role_profiles)}
            {isRootAdmin ? " · root administrator" : ""}
          </p>
          {user.household_slug && !isRootAdmin ? (
            <p className="muted">
              Household login URL: <code>/h/{user.household_slug}/login</code>
            </p>
          ) : null}
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

      {isRootAdmin ? (
        <>
          <Link to="/admin/households" className="btn-secondary btn-block link-btn">
            Manage households
          </Link>
          <Link to="/admin/integrations" className="btn-secondary btn-block link-btn">
            Integrations &amp; health
          </Link>
          <Link to="/admin/cache" className="btn-secondary btn-block link-btn">
            Audio cache management
          </Link>
          <Link to="/admin/users/deleted" className="btn-secondary btn-block link-btn">
            Deleted accounts
          </Link>
        </>
      ) : null}

      {canManageMembers(user) ? (
        <Link to="/family" className="btn-secondary btn-block link-btn">
          Household members
        </Link>
      ) : null}

      {canManageParentalControls(user) ? (
        <Link to="/parental" className="btn-secondary btn-block link-btn">
          Parental controls
        </Link>
      ) : null}

      {isHouseholdAdmin ? (
        <div className="card">
          <h2>Household login URL</h2>
          <p className="muted">
            The slug appears in your household&apos;s sign-in link. Lowercase letters, numbers, and hyphens only.
          </p>
          <input
            className="input"
            placeholder="Household slug"
            value={householdSlug}
            onChange={(e) => setHouseholdSlug(e.target.value.toLowerCase())}
          />
          <p className="muted">
            Login URL: <code>/h/{householdSlug || "your-slug"}/login</code>
          </p>
          <button
            type="button"
            className="btn-secondary btn-block"
            disabled={householdSlugBusy || !householdSlug.trim()}
            onClick={() => void saveHouseholdSlug()}
          >
            {householdSlugBusy ? "Saving…" : "Update household slug"}
          </button>
          {householdSlugMessage ? <p className="accent">{householdSlugMessage}</p> : null}
          {householdSlugError ? <p className="error">{householdSlugError}</p> : null}
        </div>
      ) : null}

      {canSetParentPin(user) ? (
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
            Link a scrobbler account for <strong>{user?.display_name}</strong>. Each household member links their own
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
