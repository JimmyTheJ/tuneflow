import { useRef, type MouseEvent } from "react";
import { TrackActionsMenu, type TrackActionsMenuHandle } from "@/components/TrackActionsMenu";
import { TrackRow } from "@/components/TrackRow";
import type { Playlist, Track } from "@/types";

type Props = {
  track: Track;
  playQueue?: Track[];
  likedVideoIds: Set<string>;
  playlists: Playlist[];
  displayTitle?: string;
  subtitle?: string;
  showBadges?: boolean;
  index?: number;
  disabled?: boolean;
  onPlay: () => void;
  onLikedChange: () => void;
  onPlaylistsChange: () => void;
};

export function TrackRowWithActions({
  track,
  playQueue,
  likedVideoIds,
  playlists,
  displayTitle,
  subtitle,
  showBadges,
  index,
  disabled,
  onPlay,
  onLikedChange,
  onPlaylistsChange,
}: Props) {
  const menuRef = useRef<TrackActionsMenuHandle>(null);

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    menuRef.current?.openAt({ top: event.clientY, left: event.clientX });
  };

  return (
    <div className="group flex items-center gap-1 rounded-lg" onContextMenu={handleContextMenu}>
      <div className="min-w-0 flex-1">
        <TrackRow
          track={track}
          displayTitle={displayTitle}
          showBadges={showBadges}
          subtitle={subtitle}
          index={index}
          disabled={disabled}
          onClick={disabled ? undefined : onPlay}
        />
      </div>
      <TrackActionsMenu
        ref={menuRef}
        track={track}
        playQueue={playQueue}
        likedVideoIds={likedVideoIds}
        playlists={playlists}
        disabled={disabled}
        onLikedChange={onLikedChange}
        onPlaylistsChange={onPlaylistsChange}
      />
    </div>
  );
}
