import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ChevronRight,
  Database,
  HeartHandshake,
  Link2,
  LogOut,
  Shield,
  Users,
  Trash2,
} from "lucide-react";
import { PinModal } from "@/components/PinModal";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
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

function SettingsLink({
  to,
  icon: Icon,
  children,
}: {
  to: string;
  icon: typeof Users;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 rounded-xl border border-border/60 bg-elevated px-4 py-3.5 transition hover:bg-highlight"
    >
      <span className="flex size-9 items-center justify-center rounded-full bg-highlight text-accent">
        <Icon className="size-4" />
      </span>
      <span className="flex-1 font-semibold">{children}</span>
      <ChevronRight className="size-4 text-text-muted" />
    </Link>
  );
}

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
    <div className="mx-auto max-w-2xl space-y-8">
      <h1 className="m-0 text-3xl font-bold tracking-tight md:text-4xl">Settings</h1>

      {user ? (
        <Card>
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-text-muted">Signed in as</p>
          <p className="mt-1 mb-0 text-lg font-bold">
            {user.display_name}
            {user.household_name ? ` · ${user.household_name}` : ""}
          </p>
          <p className="mt-1 mb-0 text-sm text-text-secondary">
            {formatRoleProfiles(user.role_profiles)}
            {isRootAdmin ? " · root administrator" : ""}
          </p>
          {user.household_slug && !isRootAdmin ? (
            <p className="mt-2 mb-0 text-sm text-text-muted">
              Household login URL: <code className="text-text-secondary">/h/{user.household_slug}/login</code>
            </p>
          ) : null}
        </Card>
      ) : null}

      {isChild && childSettings ? (
        <Card>
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-text-muted">Your limits</p>
          <p className="mt-1 mb-0 text-sm text-text-secondary">
            {childSettings.max_daily_minutes != null
              ? `${childSettings.max_daily_minutes} min/day`
              : "No daily limit"}
            {" · "}
            {childSettings.search_enabled ? "Search on" : "Search off"}
          </p>
        </Card>
      ) : null}

      <div className="space-y-2">
        <Button variant="secondary" block onClick={() => void protectedAction("switch")}>
          Switch account
        </Button>
        <Button variant="ghost" block onClick={() => void protectedAction("logout")}>
          <LogOut className="size-4" />
          Sign out
        </Button>
      </div>

      {isRootAdmin || canManageMembers(user) || canManageParentalControls(user) ? (
        <section className="space-y-2">
          <h2 className="m-0 text-sm font-bold uppercase tracking-wide text-text-muted">Management</h2>
          {isRootAdmin ? (
            <>
              <SettingsLink to="/admin/households" icon={Users}>
                Manage households
              </SettingsLink>
              <SettingsLink to="/admin/integrations" icon={Link2}>
                Integrations &amp; health
              </SettingsLink>
              <SettingsLink to="/admin/cache" icon={Database}>
                Audio cache management
              </SettingsLink>
              <SettingsLink to="/admin/users/deleted" icon={Trash2}>
                Deleted accounts
              </SettingsLink>
            </>
          ) : null}
          {canManageMembers(user) ? (
            <SettingsLink to="/family" icon={HeartHandshake}>
              Household members
            </SettingsLink>
          ) : null}
          {canManageParentalControls(user) ? (
            <SettingsLink to="/parental" icon={Shield}>
              Parental controls
            </SettingsLink>
          ) : null}
        </section>
      ) : null}

      {isHouseholdAdmin ? (
        <Card className="space-y-3">
          <h2 className="m-0 text-base font-bold">Household login URL</h2>
          <p className="m-0 text-sm text-text-secondary">
            The slug appears in your household&apos;s sign-in link. Lowercase letters, numbers, and
            hyphens only.
          </p>
          <Input
            placeholder="Household slug"
            value={householdSlug}
            onChange={(e) => setHouseholdSlug(e.target.value.toLowerCase())}
          />
          <p className="m-0 text-sm text-text-muted">
            Login URL: <code className="text-text-secondary">/h/{householdSlug || "your-slug"}/login</code>
          </p>
          <Button
            variant="secondary"
            block
            disabled={householdSlugBusy || !householdSlug.trim()}
            onClick={() => void saveHouseholdSlug()}
          >
            {householdSlugBusy ? "Saving…" : "Update household slug"}
          </Button>
          {householdSlugMessage ? <p className="m-0 text-sm text-accent">{householdSlugMessage}</p> : null}
          {householdSlugError ? <p className="m-0 text-sm text-danger-fg">{householdSlugError}</p> : null}
        </Card>
      ) : null}

      {canSetParentPin(user) ? (
        <Card className="space-y-3">
          <h2 className="m-0 text-base font-bold">Parent PIN</h2>
          <p className="m-0 text-sm text-text-secondary">
            Required for children to switch accounts on a shared device.
            {hasParentPin ? " PIN is set." : " No PIN set yet."}
          </p>
          <Input
            type="password"
            inputMode="numeric"
            placeholder="4+ digit PIN"
            value={parentPin}
            onChange={(e) => setParentPin(e.target.value)}
          />
          <Button
            variant="secondary"
            block
            onClick={() =>
              void api.setParentPin(parentPin).then(() => {
                setHasParentPin(true);
                setParentPin("");
                setMessage("Parent PIN saved");
              })
            }
          >
            {hasParentPin ? "Update parent PIN" : "Set parent PIN"}
          </Button>
        </Card>
      ) : null}

      {scrobblerProviders.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h2 className="m-0 text-base font-bold">Scrobbling</h2>
            <p className="mt-1 mb-0 text-sm text-text-secondary">
              Link a scrobbler account for <strong>{user?.display_name}</strong>. Each household
              member links their own account.
            </p>
          </div>
          {scrobblerProviders.map((provider) => {
            const status = scrobblerStatuses[provider.id];
            const pendingToken = pendingLinkTokens[provider.id];
            return (
              <Card key={provider.id} className="space-y-3">
                <p className="m-0 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {provider.name}
                </p>
                {status?.linked ? (
                  <>
                    <p className="m-0 font-semibold">Linked as {status.username}</p>
                    <label className="flex items-center gap-2 text-sm text-text-secondary">
                      <input
                        type="checkbox"
                        className="size-4 accent-accent"
                        checked={status.scrobbling_enabled}
                        onChange={(e) => void toggleScrobbling(provider.id, e.target.checked)}
                      />
                      Scrobble plays for this profile
                    </label>
                    <Button variant="secondary" block onClick={() => void unlinkScrobbler(provider.id)}>
                      Unlink {provider.name}
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="m-0 text-sm text-text-secondary">Not linked for this profile.</p>
                    <Button block onClick={() => void startScrobblerLink(provider.id)}>
                      Connect {provider.name}
                    </Button>
                    {pendingToken ? (
                      <Button
                        variant="secondary"
                        block
                        onClick={() => void completeScrobblerLink(provider.id)}
                      >
                        Complete link
                      </Button>
                    ) : null}
                  </>
                )}
              </Card>
            );
          })}
          {scrobblerError ? <p className="m-0 text-sm text-danger-fg">{scrobblerError}</p> : null}
        </section>
      ) : null}

      {!isChild ? (
        <Card className="space-y-3">
          <h2 className="m-0 text-base font-bold">Server</h2>
          <p className="m-0 text-sm text-text-secondary">
            API URL for this browser app (default: localhost:8010)
          </p>
          <Input value={apiUrl} onChange={(e) => setApiUrlState(e.target.value)} />
          <Button
            block
            onClick={() => {
              setApiUrl(apiUrl);
              setMessage("Server URL saved");
            }}
          >
            Save server URL
          </Button>
        </Card>
      ) : null}

      {message ? <p className="m-0 text-sm text-accent">{message}</p> : null}

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
