import { View } from "react-native";

import { TrackActionsMenu } from "@/components/TrackActionsMenu";
import { TrackRow } from "@/components/TrackRow";
import type { Playlist, Track } from "@/types";

type Props = {
  track: Track;
  playQueue?: Track[];
  playlists: Playlist[];
  displayTitle?: string;
  subtitle?: string;
  showBadges?: boolean;
  index?: number;
  disabled?: boolean;
  onPlay: () => void;
  onPlaylistsChange: () => void;
};

export function TrackRowWithActions({
  track,
  playQueue,
  playlists,
  displayTitle,
  subtitle,
  showBadges,
  index,
  disabled,
  onPlay,
  onPlaylistsChange,
}: Props) {
  return (
    <View className="flex-row items-center gap-1">
      <View className="min-w-0 flex-1">
        <TrackRow
          track={track}
          displayTitle={displayTitle}
          showBadges={showBadges}
          subtitle={subtitle}
          index={index}
          onPress={disabled ? undefined : onPlay}
        />
      </View>
      <TrackActionsMenu
        track={track}
        playQueue={playQueue}
        playlists={playlists}
        disabled={disabled}
        onPlaylistsChange={onPlaylistsChange}
      />
    </View>
  );
}
