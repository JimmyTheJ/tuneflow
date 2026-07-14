import { useCallback, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { api } from "@/lib/api";
import { canManageRoleProfiles } from "@/lib/permissions";
import { useAuthStore } from "@/stores/authStore";
import type { DeletedPlaylist } from "@/types";

function formatWhen(value: string | null | undefined) {
  if (!value) return "unknown date";
  return new Date(value).toLocaleString();
}

function formatDaysRemaining(expiresAt: string | null | undefined) {
  if (!expiresAt) return "retention disabled";
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return "pending purge";
  const days = Math.ceil(ms / (1000 * 60 * 60 * 24));
  return days === 1 ? "1 day remaining" : `${days} days remaining`;
}

export function DeletedPlaylistsPage() {
  const user = useAuthStore((s) => s.user);
  const [deletedPlaylists, setDeletedPlaylists] = useState<DeletedPlaylist[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<DeletedPlaylist | null>(null);
  const [busy, setBusy] = useState(false);

  const canAccess = user?.is_root_admin === true || canManageRoleProfiles(user);

  const load = useCallback(async () => {
    setDeletedPlaylists(await api.listDeletedPlaylists());
  }, []);

  useEffect(() => {
    if (!canAccess) return;
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [canAccess, load]);

  if (!canAccess) return <Navigate to="/settings" replace />;

  const runRestore = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await api.restorePlaylist(pending.id);
      setMessage(`"${pending.name}" has been restored for ${pending.owner_display_name}.`);
      setPending(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page space-y-4">
      <h1>Deleted playlists</h1>
      <p className="muted">
        Playlists removed by household members are hidden from their library but can be restored here. After the
        retention period they are permanently deleted.
      </p>
      <Link to="/settings" className="accent">
        ← Back to settings
      </Link>

      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="accent">{message}</p> : null}

      {deletedPlaylists.length === 0 ? (
        <p className="muted">No deleted playlists.</p>
      ) : (
        deletedPlaylists.map((playlist) => (
          <div key={playlist.id} className="member-row">
            <div>
              <div className="track-title">{playlist.name}</div>
              <p className="muted m-0 text-sm">
                Owner: {playlist.owner_display_name} (@{playlist.owner_username}) · {playlist.track_count}{" "}
                {playlist.track_count === 1 ? "track" : "tracks"}
              </p>
              <p className="muted m-0 text-sm">
                Deleted {formatWhen(playlist.deleted_at)}
                {playlist.deleted_by_display_name ? ` by ${playlist.deleted_by_display_name}` : ""} ·{" "}
                {formatDaysRemaining(playlist.expires_at)}
              </p>
            </div>
            <Button variant="secondary" onClick={() => setPending(playlist)}>
              Restore
            </Button>
          </div>
        ))
      )}

      <ConfirmDialog
        visible={pending != null}
        title="Restore playlist?"
        message={
          pending
            ? `Restore "${pending.name}" for ${pending.owner_display_name}? It will reappear in their library with all tracks intact.`
            : ""
        }
        confirmLabel="Restore"
        danger={false}
        busy={busy}
        onConfirm={() => void runRestore()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
