import type {
  LikeEntry,
  PlayHistoryEntry,
  Playlist,
  PlaylistDetail,
  StreamInfo,
  Track,
} from "@/types";
import { getApiToken, getApiUrl } from "./settings";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const [baseUrl, token] = await Promise.all([getApiUrl(), getApiToken()]);
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed (${response.status})`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
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
};
