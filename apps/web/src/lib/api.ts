import type {
  AiInsights,
  AiRecommendations,
  CacheEntry,
  CachePurgeResult,
  CacheSettings,
  CacheStats,
  ChildProfile,
  ChildUsageToday,
  Household,
  LikeEntry,
  LlmStatus,
  ParentalSettings,
  ParentPinEnforced,
  ParentPinStatus,
  PlayHistoryEntry,
  Playlist,
  PlaylistDetail,
  RoleProfile,
  ScrobblerConnection,
  ScrobblerConnectionStatus,
  ScrobblerLinkStart,
  ScrobblerProviderInfo,
  SearchResultsPage,
  SetupStatus,
  StreamInfo,
  TokenResponse,
  Track,
  User,
  ArtistDetail,
  ArtistStreamEvent,
  AlbumDetail,
  AlbumResolveResult,
  EqAssignment,
  EqBand,
  EqBulkTrackResult,
  EqProfile,
  EqResolveResult,
} from "@/types";
import { getAccessToken, getApiUrl } from "./settings";
import { ApiError, withRetry } from "./retry";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  auth?: boolean;
};

async function executeRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = getApiUrl();
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (options.auth !== false) {
    const token = getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    let detail = await response.text();
    try {
      const parsed = JSON.parse(detail) as { detail?: string };
      detail = parsed.detail ?? detail;
    } catch {
      /* keep */
    }
    throw new ApiError(detail || `Request failed (${response.status})`, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return withRetry(() => executeRequest<T>(path, options));
}

async function* streamArtistEvents(mbid: string): AsyncGenerator<ArtistStreamEvent> {
  const baseUrl = getApiUrl();
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${baseUrl}/api/music/artists/${mbid}/stream`, { headers });
  if (!response.ok) {
    let detail = await response.text();
    try {
      const parsed = JSON.parse(detail) as { detail?: string };
      detail = parsed.detail ?? detail;
    } catch {
      /* keep */
    }
    throw new ApiError(detail || `Request failed (${response.status})`, response.status);
  }
  if (!response.body) {
    throw new ApiError("Empty artist stream response", response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      yield JSON.parse(line) as ArtistStreamEvent;
    }
  }
  if (buffer.trim()) {
    yield JSON.parse(buffer) as ArtistStreamEvent;
  }
}

export const api = {
  setupStatus: () => request<SetupStatus>("/api/auth/setup-status", { auth: false }),
  setup: (username: string, password: string, displayName: string) =>
    request<TokenResponse>("/api/auth/setup", {
      method: "POST",
      auth: false,
      body: { username, password, display_name: displayName },
    }),
  login: (householdSlug: string, username: string, password: string) =>
    request<TokenResponse>("/api/auth/login", {
      method: "POST",
      auth: false,
      body: { household_slug: householdSlug, username, password },
    }),
  getHouseholdPublic: (slug: string) =>
    request<{ slug: string; name: string }>(`/api/households/public/${encodeURIComponent(slug)}`, { auth: false }),
  me: () => request<User>("/api/auth/me"),
  search: (q: string, options?: { limit?: number; nextPage?: string }) => {
    const params = new URLSearchParams({ q });
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.nextPage) params.set("next_page", options.nextPage);
    return request<SearchResultsPage>(`/api/music/search?${params.toString()}`);
  },
  getArtist: (mbid: string) => request<ArtistDetail>(`/api/music/artists/${mbid}`),
  streamArtist: streamArtistEvents,
  getAlbum: (mbid: string) => request<AlbumDetail>(`/api/music/albums/${mbid}`),
  resolveAlbum: (mbid: string) =>
    request<AlbumResolveResult>(`/api/music/albums/${mbid}/resolve`, { method: "POST" }),
  getStream: (videoId: string, track?: Pick<Track, "title" | "artist">) => {
    const params = new URLSearchParams();
    if (track?.title) params.set("title", track.title);
    if (track?.artist) params.set("artist", track.artist);
    const query = params.toString();
    return request<StreamInfo>(`/api/music/stream/${videoId}${query ? `?${query}` : ""}`);
  },
  listPlaylists: () => request<Playlist[]>("/api/playlists"),
  getPlaylist: (id: number) => request<PlaylistDetail>(`/api/playlists/${id}`),
  createPlaylist: (name: string) => request<Playlist>("/api/playlists", { method: "POST", body: { name } }),
  addPlaylistTrack: (playlistId: number, track: Track) =>
    request<PlaylistDetail["tracks"][number]>(`/api/playlists/${playlistId}/tracks`, {
      method: "POST",
      body: track,
    }),
  updatePlaylist: (id: number, payload: { name?: string; description?: string }) =>
    request<Playlist>(`/api/playlists/${id}`, { method: "PATCH", body: payload }),
  removePlaylistTrack: (playlistId: number, trackId: number) =>
    request<void>(`/api/playlists/${playlistId}/tracks/${trackId}`, { method: "DELETE" }),
  reorderPlaylistTracks: (playlistId: number, trackIds: number[]) =>
    request<PlaylistDetail["tracks"]>(`/api/playlists/${playlistId}/tracks/reorder`, {
      method: "POST",
      body: { track_ids: trackIds },
    }),
  listHistory: () => request<PlayHistoryEntry[]>("/api/history"),
  recordPlay: (track: Track) => request<PlayHistoryEntry>("/api/history", { method: "POST", body: track }),
  listLikes: () => request<LikeEntry[]>("/api/likes"),
  likeTrack: (track: Track) => request<LikeEntry>("/api/likes", { method: "POST", body: track }),
  unlikeTrack: (videoId: string) => request<void>(`/api/likes/${videoId}`, { method: "DELETE" }),
  listUsers: () => request<User[]>("/api/users"),
  listDeletedUsers: () => request<User[]>("/api/users/deleted"),
  createUser: (payload: {
    username: string;
    password: string;
    display_name: string;
    role_profile_ids: number[];
  }) => request<User>("/api/users", { method: "POST", body: payload }),
  updateUser: (userId: number, payload: { display_name?: string; is_active?: boolean; role_profile_ids?: number[] }) =>
    request<User>(`/api/users/${userId}`, { method: "PATCH", body: payload }),
  resetPassword: (userId: number, password: string) =>
    request<void>(`/api/users/${userId}/reset-password`, { method: "POST", body: { password } }),
  softDeleteUser: (userId: number) => request<User>(`/api/users/${userId}`, { method: "DELETE" }),
  restoreUser: (userId: number) => request<User>(`/api/users/${userId}/restore`, { method: "POST" }),
  permanentlyDeleteUser: (userId: number) =>
    request<void>(`/api/users/${userId}/permanent`, { method: "DELETE" }),
  listHouseholds: () => request<Household[]>("/api/households"),
  getMyHousehold: () => request<Household>("/api/households/mine"),
  updateMyHousehold: (payload: { slug: string }) =>
    request<Household>("/api/households/mine", { method: "PATCH", body: payload }),
  createHousehold: (payload: {
    name: string;
    slug: string;
    admin_username: string;
    admin_password: string;
    admin_display_name: string;
  }) => request<Household>("/api/households", { method: "POST", body: payload }),
  listRoleProfiles: () => request<RoleProfile[]>("/api/role-profiles"),
  createRoleProfile: (payload: { name: string; permissions: string[]; is_public?: boolean }) =>
    request<RoleProfile>("/api/role-profiles", { method: "POST", body: payload }),
  updateRoleProfile: (
    profileId: number,
    payload: { name?: string; permissions?: string[]; is_public?: boolean },
  ) => request<RoleProfile>(`/api/role-profiles/${profileId}`, { method: "PATCH", body: payload }),
  parentPinStatus: () => request<ParentPinStatus>("/api/auth/parent-pin/status"),
  parentPinEnforced: () => request<ParentPinEnforced>("/api/auth/parent-pin/enforced"),
  setParentPin: (pin: string) => request<void>("/api/auth/parent-pin", { method: "PUT", body: { pin } }),
  verifyParentPin: (pin: string) =>
    request<{ valid: boolean }>("/api/auth/verify-parent-pin", { method: "POST", body: { pin } }),
  listChildren: () => request<ChildProfile[]>("/api/parental/children"),
  getChildUsage: (childId: number) => request<ChildUsageToday>(`/api/parental/${childId}/usage`),
  getChildHistory: (childId: number) => request<PlayHistoryEntry[]>(`/api/parental/${childId}/history`),
  updateChildSettings: (childId: number, settings: Partial<ParentalSettings>) =>
    request<ParentalSettings>(`/api/parental/${childId}/settings`, { method: "PUT", body: settings }),
  getMyChildSettings: () => request<ParentalSettings>("/api/parental/me/settings"),
  aiStatus: () => request<LlmStatus>("/api/ai/status"),
  aiInsights: (refresh = false) =>
    request<AiInsights>(`/api/ai/insights${refresh ? "?refresh=true" : ""}`),
  aiRecommendations: (refresh = false) =>
    request<AiRecommendations>(`/api/ai/recommendations${refresh ? "?refresh=true" : ""}`),
  listScrobblerProviders: () => request<ScrobblerProviderInfo[]>("/api/scrobbler/providers"),
  getScrobblerStatus: (provider: string) =>
    request<ScrobblerConnectionStatus>(`/api/scrobbler/${provider}`),
  startScrobblerLink: (provider: string) =>
    request<ScrobblerLinkStart>(`/api/scrobbler/${provider}/link/start`, { method: "POST" }),
  completeScrobblerLink: (provider: string, token: string) =>
    request<ScrobblerConnection>(`/api/scrobbler/${provider}/link/complete`, {
      method: "POST",
      body: { token },
    }),
  updateScrobblerSettings: (provider: string, scrobblingEnabled: boolean) =>
    request<ScrobblerConnection>(`/api/scrobbler/${provider}`, {
      method: "PATCH",
      body: { scrobbling_enabled: scrobblingEnabled },
    }),
  unlinkScrobbler: (provider: string) =>
    request<void>(`/api/scrobbler/${provider}`, { method: "DELETE" }),
  cacheStats: () => request<CacheStats>("/api/admin/cache/stats"),
  getCacheSettings: () => request<CacheSettings>("/api/admin/cache/settings"),
  updateCacheSettings: (settings: Partial<CacheSettings>) =>
    request<CacheSettings>("/api/admin/cache/settings", { method: "PUT", body: settings }),
  listCacheEntries: (userId?: number) => {
    const params = userId != null ? `?user_id=${userId}` : "";
    return request<CacheEntry[]>(`/api/admin/cache/entries${params}`);
  },
  runCacheCleanup: () => request<CachePurgeResult>("/api/admin/cache/cleanup", { method: "POST" }),
  clearCache: (options?: { olderThanDays?: number; userId?: number }) => {
    const params = new URLSearchParams();
    if (options?.olderThanDays != null) params.set("older_than_days", String(options.olderThanDays));
    if (options?.userId != null) params.set("user_id", String(options.userId));
    const query = params.toString();
    return request<CachePurgeResult>(`/api/admin/cache${query ? `?${query}` : ""}`, { method: "DELETE" });
  },
  clearCatalogCache: (options?: { olderThanDays?: number }) => {
    const params = new URLSearchParams();
    if (options?.olderThanDays != null) params.set("older_than_days", String(options.olderThanDays));
    const query = params.toString();
    return request<CachePurgeResult>(`/api/admin/cache/catalog${query ? `?${query}` : ""}`, { method: "DELETE" });
  },
  runCatalogCacheCleanup: () =>
    request<CachePurgeResult>("/api/admin/cache/catalog/cleanup", { method: "POST" }),
  clearCacheEntry: (videoId: string) =>
    request<CachePurgeResult>(`/api/admin/cache/${videoId}`, { method: "DELETE" }),
  clearCacheEntries: (videoIds: string[]) =>
    request<CachePurgeResult>("/api/admin/cache/bulk-delete", {
      method: "POST",
      body: { video_ids: videoIds },
    }),
  listEqProfiles: () => request<EqProfile[]>("/api/eq/profiles"),
  createEqProfile: (payload: { name: string; bands: EqBand[]; preamp_db?: number }) =>
    request<EqProfile>("/api/eq/profiles", { method: "POST", body: payload }),
  getEqProfile: (profileId: number) => request<EqProfile>(`/api/eq/profiles/${profileId}`),
  updateEqProfile: (
    profileId: number,
    payload: { name?: string; bands?: EqBand[]; preamp_db?: number },
  ) => request<EqProfile>(`/api/eq/profiles/${profileId}`, { method: "PATCH", body: payload }),
  deleteEqProfile: (profileId: number) =>
    request<void>(`/api/eq/profiles/${profileId}`, { method: "DELETE" }),
  setDefaultEqProfile: (profileId: number) =>
    request<EqProfile>(`/api/eq/profiles/${profileId}/set-default`, { method: "POST" }),
  getEqTrackAssignment: (videoId: string) =>
    request<EqAssignment>(`/api/eq/tracks/${encodeURIComponent(videoId)}`),
  setEqTrackAssignment: (videoId: string, eqProfileId: number | null) =>
    request<EqAssignment>(`/api/eq/tracks/${encodeURIComponent(videoId)}`, {
      method: "PUT",
      body: { eq_profile_id: eqProfileId },
    }),
  bulkEqTrackAssignment: (videoIds: string[], eqProfileId: number | null) =>
    request<EqBulkTrackResult>("/api/eq/tracks/bulk", {
      method: "POST",
      body: { video_ids: videoIds, eq_profile_id: eqProfileId },
    }),
  getEqPlaylistAssignment: (playlistId: number) =>
    request<EqAssignment>(`/api/eq/playlists/${playlistId}`),
  setEqPlaylistAssignment: (playlistId: number, eqProfileId: number | null) =>
    request<EqAssignment>(`/api/eq/playlists/${playlistId}`, {
      method: "PUT",
      body: { eq_profile_id: eqProfileId },
    }),
  applyPlaylistEqToTracks: (playlistId: number) =>
    request<EqBulkTrackResult>(`/api/eq/playlists/${playlistId}/apply-to-tracks`, { method: "POST" }),
  clearPlaylistTrackEqs: (playlistId: number) =>
    request<EqBulkTrackResult>(`/api/eq/playlists/${playlistId}/clear-track-eqs`, { method: "POST" }),
  resolveEq: (videoId: string, playlistId?: number) => {
    const params = new URLSearchParams({ video_id: videoId });
    if (playlistId != null) params.set("playlist_id", String(playlistId));
    return request<EqResolveResult>(`/api/eq/resolve?${params.toString()}`);
  },
};
