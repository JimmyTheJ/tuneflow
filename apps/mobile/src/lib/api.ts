import type {
  AiInsights,
  AiRecommendations,
  ChildProfile,
  LikeEntry,
  LlmStatus,
  ParentalSettings,
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
  const baseUrl = await getApiUrl();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.auth !== false) {
    const token = await getAccessToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
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
      // keep raw text
    }
    throw new Error(detail || `Request failed (${response.status})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

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
  getStream: (videoId: string) => request<StreamInfo>(`/api/music/stream/${videoId}`),
  listPlaylists: () => request<Playlist[]>("/api/playlists"),
  getPlaylist: (id: number) => request<PlaylistDetail>(`/api/playlists/${id}`),
  createPlaylist: (name: string, description?: string) =>
    request<Playlist>("/api/playlists", { method: "POST", body: { name, description } }),
  addTrackToPlaylist: (playlistId: number, track: Track) =>
    request(`/api/playlists/${playlistId}/tracks`, { method: "POST", body: track }),
  listHistory: () => request<PlayHistoryEntry[]>("/api/history"),
  recordPlay: (track: Track, listenedSec?: number) =>
    request<PlayHistoryEntry>("/api/history", {
      method: "POST",
      body: { ...track, listened_sec: listenedSec },
    }),
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

  listChildren: () => request<ChildProfile[]>("/api/parental/children"),
  updateChildSettings: (childId: number, settings: Partial<ParentalSettings>) =>
    request<ParentalSettings>(`/api/parental/${childId}/settings`, {
      method: "PUT",
      body: settings,
    }),
  getMyChildSettings: () => request<ParentalSettings>("/api/parental/me/settings"),

  aiStatus: () => request<LlmStatus>("/api/ai/status"),
  aiInsights: () => request<AiInsights>("/api/ai/insights"),
  aiRecommendations: () => request<AiRecommendations>("/api/ai/recommendations"),
};
