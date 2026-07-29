import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { TrackRowWithActions } from "@/components/TrackRowWithActions";
import { formatSearchSubtitle } from "@/lib/tracks";
import type { Playlist, SearchResultGroup, Track } from "@/types";

type Props = {
  group: SearchResultGroup;
  playQueue: Track[];
  likedVideoIds: Set<string>;
  playlists: Playlist[];
  onPlayTrack: (track: Track, queue: Track[]) => void;
  onLikedChange: () => void;
  onPlaylistsChange: () => void;
  onMoreVersions?: (track: Track) => void;
  onPinChannel?: (track: Track) => void;
};

export function SearchResultGroupRow({
  group,
  playQueue,
  likedVideoIds,
  playlists,
  onPlayTrack,
  onLikedChange,
  onPlaylistsChange,
  onMoreVersions,
  onPinChannel,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const hasAlternates = group.alternates.length > 0;
  const groupTracks = [group.primary, ...group.alternates];
  const playableGroup = groupTracks.filter((track) => !track.blocked_reason);
  const shownVersions = groupTracks.length;
  const withheldVersions = Math.max(0, (group.total_versions ?? shownVersions) - shownVersions);

  const renderTrack = (track: Track, isAlternate = false) => (
    <TrackRowWithActions
      key={track.video_id}
      track={track}
      playQueue={playQueue}
      likedVideoIds={likedVideoIds}
      playlists={playlists}
      displayTitle={track.source_title ?? track.title}
      showBadges
      subtitle={
        track.blocked_reason
          ? `Blocked: ${track.blocked_reason}`
          : formatSearchSubtitle(track)
      }
      disabled={!!track.blocked_reason}
      onPlay={() => onPlayTrack(track, playableGroup.length > 0 ? playableGroup : playQueue)}
      onLikedChange={onLikedChange}
      onPlaylistsChange={onPlaylistsChange}
      groupTracks={groupTracks}
      onMoreVersions={onMoreVersions}
      onPinChannel={onPinChannel}
      className={isAlternate ? "pl-10" : undefined}
    />
  );

  return (
    <div className="rounded-lg">
      <div className="flex items-start gap-1">
        {hasAlternates ? (
          <button
            type="button"
            className="mt-3 shrink-0 rounded-md border-0 bg-transparent p-1 text-text-muted hover:bg-highlight hover:text-text"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse versions" : "Expand versions"}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </button>
        ) : (
          <span className="w-6 shrink-0" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">{renderTrack(group.primary)}</div>
      </div>
      {hasAlternates && expanded ? (
        <div className="space-y-0.5">
          {group.alternates.map((track) => renderTrack(track, true))}
          {withheldVersions > 0 && onMoreVersions ? (
            <button
              type="button"
              className="ml-10 rounded-md border-0 bg-transparent px-2 py-1 text-left text-xs text-text-muted hover:bg-highlight hover:text-text"
              onClick={() => onMoreVersions(group.primary)}
            >
              {withheldVersions} more {withheldVersions === 1 ? "version" : "versions"}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
