import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/api";
import { ApiError } from "@/lib/retry";
import { usePlayerStore } from "@/stores/playerStore";
import type { Playlist, Track } from "@/types";

type MenuPosition = {
  top: number;
  left: number;
};

export type TrackActionsMenuHandle = {
  openAt: (position: MenuPosition) => void;
};

type Props = {
  track: Track;
  playQueue?: Track[];
  likedVideoIds: Set<string>;
  playlists: Playlist[];
  disabled?: boolean;
  onLikedChange: () => void;
  onPlaylistsChange: () => void;
};

function clampMenuPosition(position: MenuPosition, menuWidth: number, menuHeight: number): MenuPosition {
  const margin = 8;
  const maxLeft = window.innerWidth - menuWidth - margin;
  const maxTop = window.innerHeight - menuHeight - margin;
  return {
    left: Math.max(margin, Math.min(position.left, maxLeft)),
    top: Math.max(margin, Math.min(position.top, maxTop)),
  };
}

export const TrackActionsMenu = forwardRef<TrackActionsMenuHandle, Props>(function TrackActionsMenu(
  {
    track,
    playQueue = [],
    likedVideoIds,
    playlists,
    disabled = false,
    onLikedChange,
    onPlaylistsChange,
  },
  ref,
) {
  const playTrack = usePlayerStore((s) => s.playTrack);
  const addToQueue = usePlayerStore((s) => s.addToQueue);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isLiked = likedVideoIds.has(track.video_id);

  const showStatus = useCallback((message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 2200);
  }, []);

  const openAt = useCallback((next: MenuPosition) => {
    setPosition(next);
    setOpen(true);
  }, []);

  useImperativeHandle(ref, () => ({ openAt }), [openAt]);

  const close = useCallback(() => {
    setOpen(false);
    setPosition(null);
  }, []);

  const openFromButton = useCallback(() => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    openAt({ top: rect.bottom + 6, left: rect.right - 220 });
  }, [openAt]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      close();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [close, open]);

  useEffect(() => {
    if (!open || !position || !menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const clamped = clampMenuPosition(position, rect.width, rect.height);
    if (clamped.left !== position.left || clamped.top !== position.top) {
      setPosition(clamped);
    }
  }, [open, position]);

  const handlePlay = () => {
    close();
    const queue = playQueue.length > 0 ? playQueue : [track];
    void playTrack(track, queue);
  };

  const handleAddToQueue = () => {
    addToQueue(track);
    showStatus("Added to queue");
    window.setTimeout(close, 1200);
  };

  const handleToggleLike = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (isLiked) {
        await api.unlikeTrack(track.video_id);
        showStatus("Removed from liked songs");
      } else {
        await api.likeTrack(track);
        showStatus("Added to liked songs");
      }
      onLikedChange();
      close();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "Could not update liked songs");
    } finally {
      setBusy(false);
    }
  };

  const handleAddToPlaylist = async (playlistId: number, playlistName: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await api.addPlaylistTrack(playlistId, track);
      showStatus(`Added to ${playlistName}`);
      onPlaylistsChange();
      close();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        showStatus(`Already in ${playlistName}`);
        close();
        return;
      }
      showStatus(err instanceof Error ? err.message : "Could not add to playlist");
    } finally {
      setBusy(false);
    }
  };

  const handleCreatePlaylist = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const playlist = await api.createPlaylist(`Playlist ${playlists.length + 1}`);
      await api.addPlaylistTrack(playlist.id, track);
      showStatus(`Added to ${playlist.name}`);
      onPlaylistsChange();
      close();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "Could not create playlist");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="track-actions-trigger"
        aria-label={`Actions for ${track.title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? close() : openFromButton())}
      >
        ⋯
      </button>
      {open && position ? (
        <div
          ref={menuRef}
          className="track-actions-menu"
          role="menu"
          style={{ top: position.top, left: position.left }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" className="track-actions-item" role="menuitem" onClick={handlePlay}>
            Play now
          </button>
          <button type="button" className="track-actions-item" role="menuitem" onClick={handleAddToQueue}>
            Add to queue
          </button>
          <button
            type="button"
            className="track-actions-item"
            role="menuitem"
            disabled={busy}
            onClick={() => void handleToggleLike()}
          >
            {isLiked ? "Unlike" : "Like"}
          </button>
          <div className="track-actions-divider" role="separator" />
          <div className="track-actions-label">Add to playlist</div>
          {playlists.length === 0 ? (
            <div className="track-actions-empty">No playlists yet</div>
          ) : (
            playlists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                className="track-actions-item track-actions-item-nested"
                role="menuitem"
                disabled={busy}
                onClick={() => void handleAddToPlaylist(playlist.id, playlist.name)}
              >
                {playlist.name}
              </button>
            ))
          )}
          <button
            type="button"
            className="track-actions-item track-actions-item-nested"
            role="menuitem"
            disabled={busy}
            onClick={() => void handleCreatePlaylist()}
          >
            New playlist…
          </button>
          {status ? (
            <div className="track-actions-status" role="status" aria-live="polite">
              {status}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
});
