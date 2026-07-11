import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

export function FamilyPage() {
  const user = useAuthStore((s) => s.user);
  const [members, setMembers] = useState<User[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"child" | "adult">("child");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMembers(await api.listUsers());
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [load]);

  if (user?.role !== "parent" && user?.role !== "admin") return <Navigate to="/settings" replace />;

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createUser({
        display_name: displayName.trim(),
        username: username.trim().toLowerCase(),
        password,
        role,
      });
      setDisplayName("");
      setUsername("");
      setPassword("");
      setMessage("Family member added");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
    }
  };

  return (
    <div className="page">
      <h1>Family members</h1>
      <p className="muted">Add accounts for your household. Child accounts get parental controls automatically.</p>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="accent">{message}</p> : null}

      <form className="card" onSubmit={(e) => void create(e)}>
        <h3>Add member</h3>
        <input className="input" placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <input className="input" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <input className="input" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="chip-row">
          {(["child", "adult"] as const).map((r) => (
            <button key={r} type="button" className={role === r ? "chip active" : "chip"} onClick={() => setRole(r)}>
              {r}
            </button>
          ))}
        </div>
        <button className="btn-primary" type="submit">
          Add member
        </button>
      </form>

      <h2 className="section-label">Household</h2>
      {members.map((m) => (
        <div key={m.id} className="member-row">
          <div>
            <div className="track-title">{m.display_name}</div>
            <div className="track-subtitle">
              @{m.username} · {m.role}
              {!m.is_active ? " · disabled" : ""}
            </div>
          </div>
          {m.role !== "parent" && m.role !== "admin" ? (
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                void api.updateUser(m.id, { is_active: !m.is_active }).then(() => load())
              }
            >
              {m.is_active ? "Disable" : "Enable"}
            </button>
          ) : null}
        </div>
      ))}

      <Link to="/parental" className="accent">
        Manage parental controls →
      </Link>
    </div>
  );
}
