import { useRef, type MouseEvent } from "react";
import { TrackActionsMenu, type TrackActionsMenuHandle } from "@/components/TrackActionsMenu";
import { TrackRow } from "@/components/TrackRow";
import { cn } from "@/lib/cn";
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
  className?: string;
  groupTracks?: Track[];
  onPlay: () => void;
  onLikedChange: () => void;
  onPlaylistsChange: () => void;
  onMoreVersions?: (track: Track) => void;
  onPinChannel?: (track: Track) => void;
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
  className,
  groupTracks,
  onPlay,
  onLikedChange,
  onPlaylistsChange,
  onMoreVersions,
  onPinChannel,
}: Props) {
  const menuRef = useRef<TrackActionsMenuHandle>(null);

  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    menuRef.current?.openAt({ top: event.clientY, left: event.clientX });
  };

  return (
    <div className={cn("group flex items-center gap-1 rounded-lg", className)} onContextMenu={handleContextMenu}>
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
        groupTracks={groupTracks}
        onMoreVersions={onMoreVersions}
        onPinChannel={onPinChannel}
      />
    </div>
  );
}
