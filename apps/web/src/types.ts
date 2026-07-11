export type UserRole = "admin" | "parent" | "adult" | "child";

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
  tracks: Array<Track & { id: number; position: number; added_at: string }>;
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
  playable_video_id?: string | null;
};

export type PlayHistoryEntry = Track & {
  id: number;
  listened_sec?: number | null;
  played_at: string;
};

export type LikeEntry = Track & { id: number; liked_at: string };

export type TokenResponse = {
  access_token: string;
  token_type: string;
  user: User;
};

export type SetupStatus = { needs_setup: boolean };

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

export type ChildProfile = { user: User; settings: ParentalSettings };

export type ChildUsageToday = {
  child_user_id: number;
  listened_minutes_today: number;
  max_daily_minutes: number | null;
  remaining_minutes: number | null;
};

export type ParentPinStatus = { has_pin: boolean };
export type ParentPinEnforced = { enforced: boolean };

export type LlmStatus = {
  enabled: boolean;
  configured: boolean;
  reachable: boolean;
  base_url: string;
  model: string;
  detail?: string | null;
};

export type AiSuggestion = { query: string; reason: string; tracks: Track[] };
export type AiRecommendations = { summary: string; suggestions: AiSuggestion[] };
export type AiInsights = {
  summary: string;
  top_artists: string[];
  listening_patterns: string[];
  recommendations: string[];
};

export type ScrobblerProviderInfo = {
  id: string;
  name: string;
};

export type ScrobblerConnectionStatus = {
  provider: string;
  configured: boolean;
  linked: boolean;
  username?: string | null;
  scrobbling_enabled: boolean;
  linked_at?: string | null;
};

export type ScrobblerLinkStart = {
  token: string;
  authorize_url: string;
};

export type ScrobblerConnection = {
  provider: string;
  username: string;
  scrobbling_enabled: boolean;
  linked_at: string;
};

export type CacheSettings = {
  cache_enabled: boolean;
  cache_retention_days: number | null;
  cache_max_size_mb: number | null;
  cache_cleanup_interval_hours: number;
  updated_at: string;
};

export type CacheStats = {
  entry_count: number;
  total_size_bytes: number;
  oldest_accessed_at: string | null;
  newest_accessed_at: string | null;
  unique_users: number;
};

export type CacheAccessUser = {
  user_id: number;
  username: string;
  display_name: string;
  first_accessed_at: string;
  last_accessed_at: string;
};

export type CacheEntry = {
  video_id: string;
  file_size_bytes: number;
  mime_type: string;
  cached_at: string;
  last_accessed_at: string;
  cached_by_user_id: number | null;
  cached_by_username: string | null;
  access_count: number;
  users: CacheAccessUser[];
};

export type CachePurgeResult = {
  deleted_entries: number;
  freed_bytes: number;
};
