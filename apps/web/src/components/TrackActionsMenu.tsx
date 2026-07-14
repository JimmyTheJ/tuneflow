import { MoreHorizontal } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { PlaylistPickerModal } from "@/components/PlaylistPickerModal";
import { EqProfilePickerModal } from "@/components/EqProfilePickerModal";
import { IconButton } from "@/components/ui/IconButton";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { canPickDownloadDirectory, downloadTrack } from "@/lib/playlistDownload";
import { useEqStore } from "@/stores/eqStore";
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
  const profiles = useEqStore((s) => s.profiles);
  const trackAssignments = useEqStore((s) => s.trackAssignments);
  const loaded = useEqStore((s) => s.loaded);
  const assignTrack = useEqStore((s) => s.assignTrack);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [eqPickerOpen, setEqPickerOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isLiked = likedVideoIds.has(track.video_id);
  const hasTrackEq = trackAssignments[track.video_id] != null;

  useEffect(() => {
    if (!loaded) {
      void useEqStore.getState().load();
    }
  }, [loaded]);

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

  const handleAddToPlaylist = () => {
    close();
    setPickerOpen(true);
  };

  const handleAssignEq = () => {
    close();
    setEqPickerOpen(true);
  };

  const handleClearTrackEq = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await assignTrack(track.video_id, null);
      showStatus("Track EQ cleared");
      close();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "Could not clear track EQ");
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await downloadTrack(track, { preferDirectory: canPickDownloadDirectory() });
      showStatus("Download started");
      close();
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "Download failed");
    } finally {
      setBusy(false);
    }
  };

  const itemClass =
    "block w-full cursor-pointer rounded-lg border-0 bg-transparent px-3 py-2.5 text-left text-sm text-text hover:bg-highlight disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <>
      <IconButton
        ref={buttonRef}
        label={`Actions for ${track.title}`}
        size="sm"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "opacity-0 group-hover:opacity-100",
          open && "opacity-100 bg-highlight text-text",
        )}
        onClick={() => (open ? close() : openFromButton())}
      >
        <MoreHorizontal className="size-4" />
      </IconButton>
      {open && position ? (
        <div
          ref={menuRef}
          className="fixed z-[80] max-h-[min(420px,calc(100vh-16px))] min-w-[220px] max-w-[min(280px,calc(100vw-16px))] overflow-y-auto rounded-xl border border-border bg-elevated p-1.5 shadow-elevated"
          role="menu"
          style={{ top: position.top, left: position.left }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button type="button" className={itemClass} role="menuitem" onClick={handlePlay}>
            Play now
          </button>
          <button type="button" className={itemClass} role="menuitem" onClick={handleAddToQueue}>
            Add to queue
          </button>
          <button
            type="button"
            className={itemClass}
            role="menuitem"
            disabled={busy}
            onClick={() => void handleToggleLike()}
          >
            {isLiked ? "Unlike" : "Like"}
          </button>
          <button
            type="button"
            className={itemClass}
            role="menuitem"
            disabled={busy}
            onClick={() => void handleDownload()}
          >
            Download
          </button>
          <div className="my-1.5 border-t border-border" role="separator" />
          <button
            type="button"
            className={itemClass}
            role="menuitem"
            disabled={busy}
            onClick={handleAssignEq}
          >
            Assign EQ profile…
          </button>
          {hasTrackEq ? (
            <button
              type="button"
              className={itemClass}
              role="menuitem"
              disabled={busy}
              onClick={() => void handleClearTrackEq()}
            >
              Clear track EQ
            </button>
          ) : null}
          <div className="my-1.5 border-t border-border" role="separator" />
          <button
            type="button"
            className={itemClass}
            role="menuitem"
            disabled={busy}
            onClick={handleAddToPlaylist}
          >
            Add to playlist…
          </button>
          {status ? (
            <div
              className="mt-1 border-t border-border px-3 py-2 text-sm text-accent"
              role="status"
              aria-live="polite"
            >
              {status}
            </div>
          ) : null}
        </div>
      ) : null}
      <PlaylistPickerModal
        visible={pickerOpen}
        title="Add to playlist"
        tracks={[track]}
        playlists={playlists}
        onClose={() => setPickerOpen(false)}
        onComplete={showStatus}
        onPlaylistsChange={onPlaylistsChange}
      />
      <EqProfilePickerModal
        visible={eqPickerOpen}
        title="Assign EQ to track"
        profiles={profiles}
        selectedProfileId={trackAssignments[track.video_id] ?? null}
        onClose={() => setEqPickerOpen(false)}
        onSelect={async (profileId) => {
          if (profileId == null) return;
          await assignTrack(track.video_id, profileId);
          showStatus("Track EQ assigned");
        }}
      />
    </>
  );
});
