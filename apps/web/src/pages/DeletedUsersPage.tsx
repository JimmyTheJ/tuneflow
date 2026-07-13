import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { formatRoleProfiles } from "@/lib/permissions";
import type { User } from "@/types";

type PendingAction =
  | { type: "restore"; user: User }
  | { type: "permanent"; user: User }
  | null;

function formatDeletedAt(value: string | null | undefined) {
  if (!value) return "unknown date";
  return new Date(value).toLocaleString();
}

export function DeletedUsersPage() {
  const user = useAuthStore((s) => s.user);
  const [deletedUsers, setDeletedUsers] = useState<User[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setDeletedUsers(await api.listDeletedUsers());
  }, []);

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [load]);

  if (user?.is_root_admin !== true) return <Navigate to="/settings" replace />;

  const runAction = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      if (pending.type === "restore") {
        await api.restoreUser(pending.user.id);
        setMessage(`${pending.user.display_name} has been restored and can sign in again.`);
      } else {
        await api.permanentlyDeleteUser(pending.user.id);
        setMessage(
          `${pending.user.display_name} has been permanently removed. Their playlists, history, and other data are gone.`,
        );
      }
      setPending(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>Deleted accounts</h1>
      <p className="muted">
        These accounts cannot sign in and are hidden from everyone except admins. You can restore them or permanently
        remove them.
      </p>
      <Link to="/family" className="accent">
        ← Back to family members
      </Link>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="accent">{message}</p> : null}

      {deletedUsers.length === 0 ? (
        <p className="muted">No deleted accounts.</p>
      ) : (
        deletedUsers.map((m) => (
          <div key={m.id} className="member-row">
            <div>
              <div className="track-title">{m.display_name}</div>
              <div className="track-subtitle">
                @{m.username} · {formatRoleProfiles(m.role_profiles)} · deleted {formatDeletedAt(m.deleted_at)}
              </div>
            </div>
            <div className="member-actions">
              <button type="button" className="btn-secondary" onClick={() => setPending({ type: "restore", user: m })}>
                Restore
              </button>
              <button
                type="button"
                className="btn-danger"
                onClick={() => setPending({ type: "permanent", user: m })}
              >
                Delete permanently
              </button>
            </div>
          </div>
        ))
      )}

      <ConfirmDialog
        visible={pending?.type === "restore"}
        title="Restore account?"
        message={
          pending?.type === "restore"
            ? `Restore "${pending.user.display_name}" (@${pending.user.username})? They will be able to sign in again, appear in the family list, and access their playlists and history.`
            : ""
        }
        confirmLabel="Restore account"
        busy={busy}
        onConfirm={runAction}
        onCancel={() => setPending(null)}
      />

      <ConfirmDialog
        visible={pending?.type === "permanent"}
        title="Permanently delete account?"
        message={
          pending?.type === "permanent"
            ? `Permanently delete "${pending.user.display_name}" (@${pending.user.username})? This cannot be undone. All of their playlists, play history, likes, and scrobbler links will be erased. The username will become available for a new account.`
            : ""
        }
        confirmLabel="Delete permanently"
        danger
        busy={busy}
        onConfirm={runAction}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
