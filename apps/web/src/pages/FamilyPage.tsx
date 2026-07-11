import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import type { User } from "@/types";

function canEditUser(current: User, target: User) {
  if (target.deleted_at) return false;
  if (current.is_admin) return true;
  if (current.role === "parent") {
    return target.id === current.id || (target.role !== "parent" && !target.is_admin);
  }
  return false;
}

function canToggleActive(current: User, target: User) {
  if (!canEditUser(current, target) || target.id === current.id || target.is_admin) {
    return false;
  }
  if (current.role === "parent" && !current.is_admin && target.role === "parent") {
    return false;
  }
  return true;
}

function canSoftDelete(current: User, target: User) {
  return current.is_admin && target.id !== current.id && !target.deleted_at;
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
  const [toggleTarget, setToggleTarget] = useState<{ user: User; enable: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setMembers(await api.listUsers());
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [load]);

  if (!user || user.role !== "parent") {
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

  const confirmToggleActive = async () => {
    if (!toggleTarget) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateUser(toggleTarget.user.id, { is_active: toggleTarget.enable });
      setMessage(
        toggleTarget.enable
          ? `${toggleTarget.user.display_name} can sign in again.`
          : `${toggleTarget.user.display_name} has been disabled. They remain visible here but cannot sign in.`,
      );
      setToggleTarget(null);
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
      <p className="muted">
        Add accounts for your household. Child accounts get parental controls automatically. Use{" "}
        <strong>Disable</strong> to block sign-in while keeping the account visible. Use <strong>Delete</strong>{" "}
        (admin only) to hide a removed account.
      </p>
      {user.is_admin ? (
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
        <div key={m.id} className={m.is_active ? "member-row" : "member-row member-row-disabled"}>
          <div>
            <div className="track-title">
              {m.display_name}
              {!m.is_active ? <span className="status-badge status-disabled">Disabled</span> : null}
              {m.is_admin ? <span className="status-badge">Admin</span> : null}
            </div>
            <div className="track-subtitle">
              @{m.username} · {m.role}
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
                onClick={() => setToggleTarget({ user: m, enable: !m.is_active })}
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
        visible={toggleTarget !== null && !toggleTarget.enable}
        title="Disable account?"
        message={
          toggleTarget && !toggleTarget.enable
            ? `Disable "${toggleTarget.user.display_name}" (@${toggleTarget.user.username})? They will not be able to sign in and will be told to contact an administrator. The account stays visible in the family list and is not deleted. Playlists and history are kept.`
            : ""
        }
        confirmLabel="Disable account"
        danger
        busy={busy}
        onConfirm={confirmToggleActive}
        onCancel={() => setToggleTarget(null)}
      />

      <ConfirmDialog
        visible={toggleTarget !== null && toggleTarget.enable}
        title="Enable account?"
        message={
          toggleTarget?.enable
            ? `Re-enable "${toggleTarget.user.display_name}" (@${toggleTarget.user.username})? They will be able to sign in again immediately.`
            : ""
        }
        confirmLabel="Enable account"
        busy={busy}
        onConfirm={confirmToggleActive}
        onCancel={() => setToggleTarget(null)}
      />

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
