import type {
  AiInsights,
  AiRecommendations,
  ChildProfile,
  ChildUsageToday,
  LikeEntry,
  LlmStatus,
  ParentalSettings,
  ParentPinEnforced,
  ParentPinStatus,
  PlayHistoryEntry,
  Playlist,
  PlaylistDetail,
  SetupStatus,
  StreamInfo,
  TokenResponse,
  Track,
  User,
} from "@/types";
import { getAccessToken, getApiUrl } from "./settings";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  auth?: boolean;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
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
    throw new Error(detail || `Request failed (${response.status})`);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  setupStatus: () => request<SetupStatus>("/api/auth/setup-status", { auth: false }),
  setup: (username: string, password: string, displayName: string) =>
    request<TokenResponse>("/api/auth/setup", {
      method: "POST",
      auth: false,
      body: { username, password, display_name: displayName },
    }),
  login: (username: string, password: string) =>
    request<TokenResponse>("/api/auth/login", {
      method: "POST",
      auth: false,
      body: { username, password },
    }),
  me: () => request<User>("/api/auth/me"),
  search: (q: string) => request<Track[]>(`/api/music/search?q=${encodeURIComponent(q)}`),
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
  listHistory: () => request<PlayHistoryEntry[]>("/api/history"),
  recordPlay: (track: Track) => request<PlayHistoryEntry>("/api/history", { method: "POST", body: track }),
  listLikes: () => request<LikeEntry[]>("/api/likes"),
  likeTrack: (track: Track) => request<LikeEntry>("/api/likes", { method: "POST", body: track }),
  unlikeTrack: (videoId: string) => request<void>(`/api/likes/${videoId}`, { method: "DELETE" }),
  listUsers: () => request<User[]>("/api/users"),
  createUser: (payload: {
    username: string;
    password: string;
    display_name: string;
    role: "adult" | "child";
  }) => request<User>("/api/users", { method: "POST", body: payload }),
  updateUser: (userId: number, payload: { is_active?: boolean }) =>
    request<User>(`/api/users/${userId}`, { method: "PATCH", body: payload }),
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
  aiInsights: () => request<AiInsights>("/api/ai/insights"),
  aiRecommendations: () => request<AiRecommendations>("/api/ai/recommendations"),
};
