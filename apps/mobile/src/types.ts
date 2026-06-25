export type Track = {
  video_id: string;
  title: string;
  artist?: string | null;
  thumbnail_url?: string | null;
  duration_sec?: number | null;
};

export type Playlist = {
  id: number;
  name: string;
  description?: string | null;
  created_at: string;
  updated_at: string;
  track_count: number;
};

export type PlaylistDetail = Playlist & {
  tracks: Array<
    Track & {
      id: number;
      position: number;
      added_at: string;
    }
  >;
};

export type StreamInfo = Track & {
  audio_url: string;
};

export type PlayHistoryEntry = Track & {
  id: number;
  listened_sec?: number | null;
  played_at: string;
};

export type LikeEntry = Track & {
  id: number;
  liked_at: string;
};
