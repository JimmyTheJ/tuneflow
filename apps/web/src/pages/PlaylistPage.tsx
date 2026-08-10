import { GripVertical, Play, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState, type DragEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EditablePlaylistTitle } from "@/components/EditablePlaylistTitle";
import { EqBulkWarningModal } from "@/components/EqBulkWarningModal";
import { EqProfilePickerModal } from "@/components/EqProfilePickerModal";
import { PlaylistDownloadButton } from "@/components/PlaylistDownloadButton";
import { TrackRow } from "@/components/TrackRow";
import { TrackThumb } from "@/components/TrackThumb";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Skeleton, TrackRowSkeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { asTrackRow, isPlayablePlaylistTrack, playablePlaylistTracks } from "@/lib/playlistUtils";
import { useEqStore } from "@/stores/eqStore";
import { usePlayerStore } from "@/stores/playerStore";
import type { PlaylistDetail } from "@/types";

export function PlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [eqPickerOpen, setEqPickerOpen] = useState(false);
  const [applyWarningOpen, setApplyWarningOpen] = useState(false);
  const [clearWarningOpen, setClearWarningOpen] = useState(false);
  const [deleteWarningOpen, setDeleteWarningOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  const [eqStatus, setEqStatus] = useState<string | null>(null);
  const playTrack = usePlayerStore((s) => s.playTrack);
  const profiles = useEqStore((s) => s.profiles);
  const playlistAssignments = useEqStore((s) => s.playlistAssignments);
  const assignPlaylist = useEqStore((s) => s.assignPlaylist);
  const applyPlaylistToTracks = useEqStore((s) => s.applyPlaylistToTracks);
  const clearPlaylistTrackEqs = useEqStore((s) => s.clearPlaylistTrackEqs);
  const ensurePlaylistAssignment = useEqStore((s) => s.ensurePlaylistAssignment);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setPlaylist(await api.getPlaylist(Number(id)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load playlist");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!playlist) return;
    void ensurePlaylistAssignment(playlist.id);
  }, [ensurePlaylistAssignment, playlist?.id]);

  const showEqStatus = (message: string) => {
    setEqStatus(message);
    window.setTimeout(() => setEqStatus(null), 2400);
  };

  const handleRename = async (name: string) => {
    if (!playlist) return;
    const updated = await api.updatePlaylist(playlist.id, { name });
    setPlaylist({ ...playlist, name: updated.name });
  };

  const handleVisibility = async (visibility: "private" | "household") => {
    if (!playlist || playlist.is_owner === false) return;
    try {
      const updated = await api.updatePlaylist(playlist.id, { visibility });
      setPlaylist({ ...playlist, visibility: updated.visibility });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update visibility");
    }
  };

  const handleCopy = async () => {
    if (!playlist) return;
    setCopyBusy(true);
    try {
      const copied = await api.copyPlaylist(playlist.id);
      navigate(`/playlist/${copied.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not copy playlist");
    } finally {
      setCopyBusy(false);
    }
  };

  const handleDeletePlaylist = async () => {
    if (!playlist) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await api.deletePlaylist(playlist.id);
      navigate("/library", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete playlist");
      setDeleteWarningOpen(false);
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleRemoveTrack = async (trackId: number) => {
    if (!playlist) return;
    const previous = playlist.tracks;
    const nextTracks = previous.filter((track) => track.id !== trackId);
    setPlaylist({ ...playlist, tracks: nextTracks, track_count: nextTracks.length });
    try {
      await api.removePlaylistTrack(playlist.id, trackId);
    } catch (err) {
      setPlaylist({ ...playlist, tracks: previous, track_count: previous.length });
      setError(err instanceof Error ? err.message : "Could not remove track");
    }
  };

  const reorderTracks = async (fromIndex: number, toIndex: number) => {
    if (!playlist || fromIndex === toIndex) return;
    const previous = playlist.tracks;
    const nextTracks = [...previous];
    const [moved] = nextTracks.splice(fromIndex, 1);
    nextTracks.splice(toIndex, 0, moved);
    setPlaylist({ ...playlist, tracks: nextTracks });
    try {
      await api.reorderPlaylistTracks(
        playlist.id,
        nextTracks.map((track) => track.id),
      );
    } catch (err) {
      setPlaylist({ ...playlist, tracks: previous });
      setError(err instanceof Error ? err.message : "Could not reorder tracks");
    }
  };

  const handleDragStart = (event: DragEvent<HTMLButtonElement>, index: number) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDropTargetIndex(null);
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (draggedIndex != null && draggedIndex !== index) {
      setDropTargetIndex(index);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, index: number) => {
    event.preventDefault();
    const fromIndex = Number(event.dataTransfer.getData("text/plain"));
    if (Number.isFinite(fromIndex)) {
      void reorderTracks(fromIndex, index);
    }
    handleDragEnd();
  };

  if (error && !playlist) return <p className="text-danger-fg">{error}</p>;

  if (!playlist) {
    return (
      <div className="space-y-6">
        <div className="flex gap-6">
          <Skeleton className="size-48 shrink-0 rounded-xl" />
          <div className="flex flex-1 flex-col justify-end gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <TrackRowSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const coverId = playlist.tracks.find(isPlayablePlaylistTrack)?.video_id;
  const playable = playablePlaylistTracks(playlist.tracks);
  const unmatchedCount = playlist.match_summary?.unmatched ?? playlist.tracks.filter((t) => !isPlayablePlaylistTrack(t)).length;
  const isOwner = playlist.is_owner !== false;
  const playAll = () => {
    if (playable.length === 0) return;
    void playTrack(playable[0], playable, {
      queueSource: { type: "playlist", id: playlist.id },
    });
  };

  const playlistEqProfileId = playlistAssignments[playlist.id] ?? null;
  const playlistEqProfile = profiles.find((profile) => profile.id === playlistEqProfileId) ?? null;

  return (
    <div className="space-y-6">
      <div className="relative -mx-4 -mt-6 overflow-hidden rounded-b-2xl md:-mx-8 md:-mt-8">
        <div className="absolute inset-0 bg-gradient-to-b from-accent-dim/80 via-elevated to-base" />
        <div className="relative flex flex-col gap-6 px-4 py-10 sm:flex-row sm:items-end md:px-8">
          {coverId ? (
            <TrackThumb
              videoId={coverId}
              className="size-48 shrink-0 rounded-xl shadow-elevated sm:size-52"
              fallbackClassName="size-48 shrink-0 rounded-xl shadow-elevated sm:size-52"
            />
          ) : (
            <div className="flex size-48 shrink-0 items-center justify-center rounded-xl bg-highlight shadow-elevated sm:size-52" />
          )}
          <div className="min-w-0 flex-1 pb-1">
            <p className="m-0 text-xs font-bold uppercase tracking-widest text-text-secondary">
              Playlist
            </p>
            <EditablePlaylistTitle
              name={playlist.name}
              readOnly={!isOwner}
              onSave={handleRename}
            />
            <p className="m-0 text-sm text-text-secondary">
              {playlist.tracks.length} {playlist.tracks.length === 1 ? "track" : "tracks"}
            </p>
            <div className="mt-5 flex flex-wrap items-start gap-3">
              <Button
                size="lg"
                disabled={playable.length === 0}
                onClick={playAll}
                className="!rounded-full gap-2"
              >
                <Play className="size-5 fill-current" />
                Play
              </Button>
              <PlaylistDownloadButton playlist={playlist} disabled={!isOwner} />
              {isOwner ? (
                <>
                  <Button
                    variant={playlist.visibility === "private" ? "secondary" : "ghost"}
                    size="lg"
                    className="!rounded-full"
                    onClick={() => void handleVisibility("private")}
                  >
                    Private
                  </Button>
                  <Button
                    variant={playlist.visibility === "household" ? "secondary" : "ghost"}
                    size="lg"
                    className="!rounded-full"
                    onClick={() => void handleVisibility("household")}
                  >
                    Household
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  size="lg"
                  className="!rounded-full"
                  disabled={copyBusy}
                  onClick={() => void handleCopy()}
                >
                  {copyBusy ? "Saving…" : "Save a copy"}
                </Button>
              )}
              {isOwner ? (
                <>
              <Button variant="secondary" size="lg" className="!rounded-full" onClick={() => setEqPickerOpen(true)}>
                {playlistEqProfile ? `EQ: ${playlistEqProfile.name}` : "Assign playlist EQ"}
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="!rounded-full"
                disabled={!playlistEqProfile || playlist.tracks.length === 0}
                onClick={() => setApplyWarningOpen(true)}
              >
                Apply playlist EQ to every track
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="!rounded-full text-danger-fg"
                disabled={playlist.tracks.length === 0}
                onClick={() => setClearWarningOpen(true)}
              >
                Clear all track EQs
              </Button>
              <Button
                variant="ghost"
                size="lg"
                className="!rounded-full gap-2 text-danger-fg"
                onClick={() => setDeleteWarningOpen(true)}
              >
                <Trash2 className="size-4" />
                Delete playlist
              </Button>
                </>
              ) : null}
            </div>
            {unmatchedCount > 0 ? (
              <p className="mt-3 mb-0 text-sm text-text-secondary">
                {playlist.match_summary
                  ? `${playlist.match_summary.matched} matched · ${playlist.match_summary.unmatched} unmatched`
                  : `${unmatchedCount} tracks could not be matched and will be skipped when playing`}
                {playlist.match_summary?.pending ? ` · ${playlist.match_summary.pending} pending` : ""}
              </p>
            ) : null}
            {!isOwner && playlist.owner_display_name ? (
              <p className="mt-2 mb-0 text-sm text-text-muted">Shared by {playlist.owner_display_name}</p>
            ) : null}
          </div>
        </div>
      </div>

      {error ? <p className="text-danger-fg">{error}</p> : null}
      {eqStatus ? (
        <p className="text-sm text-accent" role="status" aria-live="polite">
          {eqStatus}
        </p>
      ) : null}

      <div className="space-y-0.5">
        {playlist.tracks.map((track, index) => {
          const isDragging = draggedIndex === index;
          const isDropTarget = dropTargetIndex === index;

          return (
            <div
              key={track.id}
              className={cn(
                "group flex items-center gap-1 rounded-lg transition-colors",
                isDragging && "opacity-40",
                isDropTarget && "outline outline-dashed outline-accent",
              )}
              onDragOver={(event) => handleDragOver(event, index)}
              onDragLeave={() => setDropTargetIndex(null)}
              onDrop={(event) => handleDrop(event, index)}
            >
              {isOwner ? (
              <button
                type="button"
                className="cursor-grab touch-none px-1 py-2 text-text-muted hover:text-text active:cursor-grabbing"
                draggable
                aria-label={`Reorder ${track.title}`}
                onDragStart={(event) => handleDragStart(event, index)}
                onDragEnd={handleDragEnd}
              >
                <GripVertical className="size-4" />
              </button>
              ) : (
                <div className="w-6" />
              )}
              <div className="min-w-0 flex-1">
                <TrackRow
                  track={asTrackRow(track)}
                  index={index + 1}
                  disabled={!isPlayablePlaylistTrack(track)}
                  detail={
                    isPlayablePlaylistTrack(track)
                      ? undefined
                      : track.match_status === "pending"
                        ? "Matching…"
                        : "No YouTube match"
                  }
                  onClick={
                    isPlayablePlaylistTrack(track)
                      ? () =>
                          void playTrack(asTrackRow(track), playable, {
                            queueSource: { type: "playlist", id: playlist.id },
                          })
                      : undefined
                  }
                />
              </div>
              {isOwner ? (
              <IconButton
                label={`Remove ${track.title} from playlist`}
                size="sm"
                className="opacity-0 group-hover:opacity-100"
                onClick={() => void handleRemoveTrack(track.id)}
              >
                <X className="size-3.5" />
              </IconButton>
              ) : (
                <div className="w-8" />
              )}
            </div>
          );
        })}
      </div>

      <EqProfilePickerModal
        visible={eqPickerOpen}
        title="Assign EQ to playlist"
        profiles={profiles}
        selectedProfileId={playlistEqProfileId}
        onClose={() => setEqPickerOpen(false)}
        onSelect={async (profileId) => {
          await assignPlaylist(playlist.id, profileId);
          showEqStatus(profileId == null ? "Playlist EQ cleared" : "Playlist EQ assigned");
        }}
      />
      <EqBulkWarningModal
        visible={applyWarningOpen}
        title="Apply playlist EQ to every track?"
        description={`This will permanently assign the playlist EQ profile "${playlistEqProfile?.name ?? "profile"}" to every track in this playlist. Any existing per-track EQ assignments will be overwritten.`}
        trackCount={playlist.tracks.length}
        confirmLabel="Apply to every track"
        confirmPhrase="APPLY"
        onClose={() => setApplyWarningOpen(false)}
        onConfirm={async () => {
          const result = await applyPlaylistToTracks(playlist.id);
          showEqStatus(`Updated EQ on ${result.updated} tracks`);
        }}
      />
      <EqBulkWarningModal
        visible={clearWarningOpen}
        title="Remove all individual track EQs?"
        description="This permanently deletes every per-track EQ assignment in this playlist. Tracks will fall back to the playlist EQ, queue EQ, or your default profile."
        trackCount={playlist.tracks.length}
        confirmLabel="Clear all track EQs"
        confirmPhrase="REMOVE"
        onClose={() => setClearWarningOpen(false)}
        onConfirm={async () => {
          const result = await clearPlaylistTrackEqs(playlist.id);
          showEqStatus(`Cleared EQ on ${result.cleared} tracks`);
        }}
      />
      <ConfirmDialog
        visible={deleteWarningOpen}
        title="Delete playlist?"
        message={`Delete "${playlist.name}"?\n\nIt will be removed from your library. A household administrator can restore it within 90 days. After that it will be permanently deleted along with its tracks.`}
        confirmLabel="Delete playlist"
        danger
        busy={deleteBusy}
        onConfirm={() => void handleDeletePlaylist()}
        onCancel={() => setDeleteWarningOpen(false)}
      />
    </div>
  );
}
