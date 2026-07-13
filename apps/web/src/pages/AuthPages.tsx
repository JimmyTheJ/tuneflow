import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";

type LoginPageProps = {
  presetHouseholdSlug?: string;
};

export function LoginPage({ presetHouseholdSlug }: LoginPageProps = {}) {
  const params = useParams();
  const householdSlugFromRoute = presetHouseholdSlug ?? params.householdSlug;
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const [householdSlug, setHouseholdSlug] = useState(householdSlugFromRoute ?? "");
  const [householdName, setHouseholdName] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const lockHousehold = Boolean(householdSlugFromRoute);

  useEffect(() => {
    void api.setupStatus().then((s) => {
      if (s.needs_setup) navigate("/setup", { replace: true });
    });
  }, [navigate]);

  useEffect(() => {
    if (!householdSlugFromRoute) return;
    setHouseholdSlug(householdSlugFromRoute);
    void api
      .getHouseholdPublic(householdSlugFromRoute)
      .then((household) => setHouseholdName(household.name))
      .catch(() => setHouseholdName(null));
  }, [householdSlugFromRoute]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(householdSlug.trim().toLowerCase(), username.trim().toLowerCase(), password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--color-accent-dim)_0%,_transparent_55%),radial-gradient(ellipse_at_bottom_right,_#1a1a2e_0%,_var(--color-base)_60%)]" />
      <form
        className="relative w-full max-w-md space-y-4 rounded-2xl border border-border bg-elevated/90 p-8 shadow-elevated backdrop-blur-xl"
        onSubmit={(e) => void submit(e)}
      >
        <div>
          <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent">Tuneflow</div>
          <h1 className="m-0 text-3xl font-extrabold tracking-tight">
            {householdName ? householdName : "Welcome back"}
          </h1>
          <p className="mt-2 mb-0 text-sm text-text-secondary">
            {lockHousehold
              ? `Sign in to ${householdSlugFromRoute}`
              : "Sign in with your household, username, and password."}
          </p>
        </div>
        {!lockHousehold ? (
          <Input
            placeholder="Household (e.g. siglerfive)"
            value={householdSlug}
            onChange={(e) => setHouseholdSlug(e.target.value)}
          />
        ) : null}
        <Input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
        />
        <Input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {error ? <p className="m-0 text-sm text-danger-fg">{error}</p> : null}
        <Button type="submit" block disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </Button>
        {!lockHousehold ? (
          <p className="m-0 text-center text-xs text-text-muted">
            Root administrators: use household <code className="text-text-secondary">system</code>.
          </p>
        ) : null}
      </form>
    </div>
  );
}

export function SetupPage() {
  const setup = useAuthStore((s) => s.setup);
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState("Administrator");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await setup(username.trim().toLowerCase(), password, displayName.trim());
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--color-accent-dim)_0%,_transparent_55%),radial-gradient(ellipse_at_bottom_left,_#1a1a2e_0%,_var(--color-base)_60%)]" />
      <form
        className="relative w-full max-w-md space-y-4 rounded-2xl border border-border bg-elevated/90 p-8 shadow-elevated backdrop-blur-xl"
        onSubmit={(e) => void submit(e)}
      >
        <div>
          <div className="mb-1 text-sm font-bold uppercase tracking-widest text-accent">Tuneflow</div>
          <h1 className="m-0 text-3xl font-extrabold tracking-tight">Welcome</h1>
          <p className="mt-2 mb-0 text-sm text-text-secondary">
            Create the root administrator account for this server. Root admins belong to the system
            household, manage households and system settings, and cannot add members to that
            household.
          </p>
        </div>
        <Input
          placeholder="Display name"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
        />
        <Input
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <Input
          type="password"
          placeholder="Password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
        />
        {error ? <p className="m-0 text-sm text-danger-fg">{error}</p> : null}
        <Button type="submit" block>
          Create account
        </Button>
        <p className="m-0 text-center text-xs text-text-muted">
          Already set up?{" "}
          <Link to="/login" className="font-semibold text-accent hover:underline">
            Sign in
          </Link>{" "}
          with household <code className="text-text-secondary">system</code>.
        </p>
      </form>
    </div>
  );
}
