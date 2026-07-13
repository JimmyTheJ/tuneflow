import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
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
    <div className="auth-page">
      <form className="auth-card" onSubmit={(e) => void submit(e)}>
        <h1>{householdName ? householdName : "Tuneflow"}</h1>
        <p className="muted">
          {lockHousehold
            ? `Sign in to ${householdSlugFromRoute}`
            : "Sign in with your household, username, and password."}
        </p>
        {!lockHousehold ? (
          <input
            className="input"
            placeholder="Household (e.g. siglerfive)"
            value={householdSlug}
            onChange={(e) => setHouseholdSlug(e.target.value)}
          />
        ) : null}
        <input className="input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input
          className="input"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error ? <p className="error">{error}</p> : null}
        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
        {!lockHousehold ? (
          <p className="muted">Root administrators: use household <code>system</code>.</p>
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
    <div className="auth-page">
      <form className="auth-card" onSubmit={(e) => void submit(e)}>
        <h1>Welcome to Tuneflow</h1>
        <p className="muted">
          Create the root administrator account for this server. Root admins belong to the system household, manage
          households and system settings, and cannot add members to that household.
        </p>
        <input className="input" placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <input className="input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input
          className="input"
          type="password"
          placeholder="Password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
        />
        {error ? <p className="error">{error}</p> : null}
        <button className="btn-primary" type="submit">
          Create account
        </button>
        <p className="muted">
          Already set up? <Link to="/login">Sign in</Link> with household <code>system</code>.
        </p>
      </form>
    </div>
  );
}
