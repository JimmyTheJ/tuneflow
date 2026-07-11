export type UserRole = "parent" | "adult" | "child";

export type User = {
  id: number;
  username: string;
  display_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
};

export type Track = {
  video_id: string;
  title: string;
  artist?: string | null;
  thumbnail_url?: string | null;
  duration_sec?: number | null;
  blocked_reason?: string | null;
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

export type StreamSelection = {
  video: boolean;
  audio: boolean;
};

export type StreamInfo = Track & {
  audio_url: string;
  video_url?: string | null;
  mime_type?: string;
  video_mime_type?: string | null;
  has_video?: boolean;
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

export type TokenResponse = {
  access_token: string;
  token_type: string;
  user: User;
};

export type SetupStatus = {
  needs_setup: boolean;
};

export type ParentalSettings = {
  child_user_id: number;
  block_explicit: boolean;
  search_enabled: boolean;
  max_daily_minutes: number | null;
  allowed_start_hour: number;
  allowed_end_hour: number;
  blocked_keywords: string[];
  blocked_video_ids: string[];
  updated_at: string;
};

export type ChildUsageToday = {
  child_user_id: number;
  listened_minutes_today: number;
  max_daily_minutes: number | null;
  remaining_minutes: number | null;
};

export type ChildProfile = {
  user: User;
  settings: ParentalSettings;
};

export type ParentPinStatus = {
  has_pin: boolean;
};

export type ParentPinEnforced = {
  enforced: boolean;
};

export type LlmStatus = {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  base_url: string;
  model: string;
  detail?: string | null;
};

export type AiSuggestion = {
  query: string;
  reason: string;
  tracks: Track[];
};

export type AiRecommendations = {
  summary: string;
  suggestions: AiSuggestion[];
};

export type AiInsights = {
  summary: string;
  top_artists: string[];
  listening_patterns: string[];
  recommendations: string[];
};
