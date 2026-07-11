import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

function canEditUser(current: User, target: User) {
  if (target.deleted_at) return false;
  if (current.role === "admin") return true;
  if (current.role === "parent") {
    return target.id === current.id || (target.role !== "parent" && target.role !== "admin");
  }
  return false;
}

function canToggleActive(current: User, target: User) {
  return canEditUser(current, target) && target.role !== "parent" && target.role !== "admin";
}

function canSoftDelete(current: User, target: User) {
  return current.role === "admin" && target.id !== current.id && !target.deleted_at;
}

export function FamilyPage() {
  const user = useAuthStore((s) => s.user);
  const hydrate = useAuthStore((s) => s.hydrate);
  const [members, setMembers] = useState<User[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"child" | "adult">("child");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setMembers(await api.listUsers());
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [load]);

  if (!user || (user.role !== "parent" && user.role !== "admin")) {
    return <Navigate to="/settings" replace />;
  }

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

  const openEdit = (member: User) => {
    setEditing(member);
    setEditDisplayName(member.display_name);
    setEditPassword("");
    setError(null);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const trimmedName = editDisplayName.trim();
      if (!trimmedName) {
        setError("Display name is required");
        return;
      }
      if (trimmedName !== editing.display_name) {
        await api.updateUser(editing.id, { display_name: trimmedName });
      }
      if (editPassword.trim()) {
        await api.resetPassword(editing.id, editPassword);
      }
      setEditing(null);
      setMessage(`Updated ${trimmedName}`);
      if (editing.id === user?.id) {
        await hydrate();
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update account");
    } finally {
      setBusy(false);
    }
  };

  const confirmSoftDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.softDeleteUser(deleteTarget.id);
      setMessage(
        `${deleteTarget.display_name} has been removed. They cannot sign in and are hidden from the family list.`,
      );
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete account");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>Family members</h1>
      <p className="muted">Add accounts for your household. Child accounts get parental controls automatically.</p>
      {user.role === "admin" ? (
        <Link to="/admin/users/deleted" className="accent">
          View deleted accounts →
        </Link>
      ) : null}
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
          <div className="member-actions">
            {canEditUser(user, m) ? (
              <button type="button" className="btn-secondary" onClick={() => openEdit(m)}>
                Edit
              </button>
            ) : null}
            {canToggleActive(user, m) ? (
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
            {canSoftDelete(user, m) ? (
              <button type="button" className="btn-danger" onClick={() => setDeleteTarget(m)}>
                Delete
              </button>
            ) : null}
          </div>
        </div>
      ))}

      <Link to="/parental" className="accent">
        Manage parental controls →
      </Link>

      {editing ? (
        <div className="modal-overlay" onClick={() => !busy && setEditing(null)}>
          <form
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void saveEdit();
            }}
          >
            <h3>Edit {editing.display_name}</h3>
            <p className="muted">@{editing.username} · {editing.role}</p>
            <input
              className="input"
              placeholder="Display name"
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
            />
            <input
              className="input"
              type="password"
              placeholder="New password (leave blank to keep current)"
              value={editPassword}
              onChange={(e) => setEditPassword(e.target.value)}
            />
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)} disabled={busy}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                {busy ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <ConfirmDialog
        visible={deleteTarget !== null}
        title="Remove account?"
        message={
          deleteTarget
            ? `Remove "${deleteTarget.display_name}" (@${deleteTarget.username})? They will immediately be signed out and unable to log in. Their playlists and history are kept and can be restored later from Deleted accounts. This is not a permanent deletion.`
            : ""
        }
        confirmLabel="Remove account"
        danger
        busy={busy}
        onConfirm={confirmSoftDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
