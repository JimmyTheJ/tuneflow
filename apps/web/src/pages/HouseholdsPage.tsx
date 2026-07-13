import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import type { Household } from "@/types";

export function HouseholdsPage() {
  const user = useAuthStore((s) => s.user);
  const [households, setHouseholds] = useState<Household[]>([]);
  const [name, setName] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setHouseholds(await api.listHouseholds());
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load households"));
  }, [load]);

  if (user?.is_root_admin !== true) {
    return <Navigate to="/settings" replace />;
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.createHousehold({
        name: name.trim(),
        admin_display_name: adminDisplayName.trim(),
        admin_username: adminUsername.trim().toLowerCase(),
        admin_password: adminPassword,
      });
      setName("");
      setAdminDisplayName("");
      setAdminUsername("");
      setAdminPassword("");
      setMessage("Household created with its administrator account");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create household");
    }
  };

  return (
    <div className="page">
      <h1>Households</h1>
      <p className="muted">
        Create isolated households on this server. Each household gets its own administrator account and member
        management.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="accent">{message}</p> : null}

      <form className="card" onSubmit={(e) => void create(e)}>
        <h3>Create household</h3>
        <input className="input" placeholder="Household name" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className="input"
          placeholder="Administrator display name"
          value={adminDisplayName}
          onChange={(e) => setAdminDisplayName(e.target.value)}
        />
        <input
          className="input"
          placeholder="Administrator username"
          value={adminUsername}
          onChange={(e) => setAdminUsername(e.target.value)}
        />
        <input
          className="input"
          type="password"
          placeholder="Administrator password"
          value={adminPassword}
          onChange={(e) => setAdminPassword(e.target.value)}
        />
        <button className="btn-primary" type="submit">
          Create household
        </button>
      </form>

      <h2 className="section-label">Existing households</h2>
      {households.length === 0 ? <p className="muted">No households yet.</p> : null}
      {households.map((household) => (
        <div key={household.id} className="member-row">
          <div>
            <div className="track-title">{household.name}</div>
            <div className="track-subtitle">
              {household.member_count} member{household.member_count === 1 ? "" : "s"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
