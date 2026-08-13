import { create } from "zustand";
import { api } from "@/lib/api";
import { syncEqPlayback } from "@/lib/eqSync";
import type { EqBand, EqProfile } from "@/types";

type EqState = {
  profiles: EqProfile[];
  trackAssignments: Record<string, number>;
  playlistAssignments: Record<number, number>;
  loaded: boolean;
  enabled: boolean;
  load: (userId?: number | null) => Promise<void>;
  reset: () => void;
  setEnabled: (enabled: boolean) => void;
  createProfile: (name: string, bands: EqBand[], preampDb?: number) => Promise<EqProfile>;
  updateProfile: (
    profileId: number,
    payload: { name?: string; bands?: EqBand[]; preamp_db?: number },
  ) => Promise<EqProfile>;
  deleteProfile: (profileId: number) => Promise<void>;
  setDefaultProfile: (profileId: number) => Promise<void>;
  assignTrack: (videoId: string, profileId: number | null) => Promise<void>;
  assignPlaylist: (playlistId: number, profileId: number | null) => Promise<void>;
  bulkAssignTracks: (videoIds: string[], profileId: number | null) => Promise<{ updated: number; cleared: number }>;
  applyPlaylistToTracks: (playlistId: number) => Promise<{ updated: number; cleared: number }>;
  clearPlaylistTrackEqs: (playlistId: number) => Promise<{ updated: number; cleared: number }>;
  ensurePlaylistAssignment: (playlistId: number) => Promise<void>;
  ensureTrackAssignment: (videoId: string) => Promise<void>;
};

const EQ_ENABLED_KEY_PREFIX = "tuneflow.eq.enabled.";

function eqEnabledStorageKey(userId: number): string {
  return `${EQ_ENABLED_KEY_PREFIX}${userId}`;
}

function readStoredEnabled(userId: number | null): boolean {
  if (userId == null) return true;
  const raw = localStorage.getItem(eqEnabledStorageKey(userId));
  if (raw == null) return true;
  return raw === "true";
}

function writeStoredEnabled(userId: number | null, enabled: boolean): void {
  if (userId == null) return;
  localStorage.setItem(eqEnabledStorageKey(userId), String(enabled));
}

function refreshPlaybackEq(): Promise<void> {
  return syncEqPlayback();
}

let loadPromise: Promise<void> | null = null;
let preferenceUserId: number | null = null;

export const useEqStore = create<EqState>((set, get) => ({
  profiles: [],
  trackAssignments: {},
  playlistAssignments: {},
  loaded: false,
  enabled: true,

  load: async (userId) => {
    if (userId != null) preferenceUserId = userId;
    if (get().loaded) return;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      const profiles = await api.listEqProfiles();
      set({
        profiles,
        loaded: true,
        enabled: readStoredEnabled(preferenceUserId),
      });
      await refreshPlaybackEq();
    })().finally(() => {
      loadPromise = null;
    });

    return loadPromise;
  },

  reset: () => {
    loadPromise = null;
    preferenceUserId = null;
    set({
      profiles: [],
      trackAssignments: {},
      playlistAssignments: {},
      loaded: false,
      enabled: true,
    });
  },

  setEnabled: (enabled) => {
    set({ enabled });
    writeStoredEnabled(preferenceUserId, enabled);
    refreshPlaybackEq();
  },

  createProfile: async (name, bands, preampDb = 0) => {
    const profile = await api.createEqProfile({ name, bands, preamp_db: preampDb });
    set((state) => ({ profiles: [...state.profiles, profile] }));
    return profile;
  },

  updateProfile: async (profileId, payload) => {
    const profile = await api.updateEqProfile(profileId, payload);
    set((state) => ({
      profiles: state.profiles.map((item) => (item.id === profileId ? profile : item)),
    }));
    refreshPlaybackEq();
    return profile;
  },

  deleteProfile: async (profileId) => {
    await api.deleteEqProfile(profileId);
    set((state) => {
      const nextTrackAssignments = { ...state.trackAssignments };
      const nextPlaylistAssignments = { ...state.playlistAssignments };
      for (const [videoId, assignedId] of Object.entries(nextTrackAssignments)) {
        if (assignedId === profileId) delete nextTrackAssignments[videoId];
      }
      for (const [playlistId, assignedId] of Object.entries(nextPlaylistAssignments)) {
        if (assignedId === profileId) delete nextPlaylistAssignments[Number(playlistId)];
      }
      return {
        profiles: state.profiles.filter((profile) => profile.id !== profileId),
        trackAssignments: nextTrackAssignments,
        playlistAssignments: nextPlaylistAssignments,
      };
    });
    refreshPlaybackEq();
  },

  setDefaultProfile: async (profileId) => {
    const profile = await api.setDefaultEqProfile(profileId);
    set((state) => ({
      profiles: state.profiles.map((item) => ({
        ...item,
        is_default: item.id === profile.id,
      })),
    }));
    refreshPlaybackEq();
  },

  assignTrack: async (videoId, profileId) => {
    const assignment = await api.setEqTrackAssignment(videoId, profileId);
    set((state) => {
      const next = { ...state.trackAssignments };
      if (assignment.eq_profile_id == null) {
        delete next[videoId];
      } else {
        next[videoId] = assignment.eq_profile_id;
      }
      return { trackAssignments: next };
    });
    refreshPlaybackEq();
  },

  assignPlaylist: async (playlistId, profileId) => {
    const assignment = await api.setEqPlaylistAssignment(playlistId, profileId);
    set((state) => {
      const next = { ...state.playlistAssignments };
      if (assignment.eq_profile_id == null) {
        delete next[playlistId];
      } else {
        next[playlistId] = assignment.eq_profile_id;
      }
      return { playlistAssignments: next };
    });
    refreshPlaybackEq();
  },

  bulkAssignTracks: async (videoIds, profileId) => {
    const result = await api.bulkEqTrackAssignment(videoIds, profileId);
    if (profileId == null) {
      set((state) => {
        const next = { ...state.trackAssignments };
        for (const videoId of videoIds) {
          delete next[videoId];
        }
        return { trackAssignments: next };
      });
    } else {
      set((state) => {
        const next = { ...state.trackAssignments };
        for (const videoId of videoIds) {
          next[videoId] = profileId;
        }
        return { trackAssignments: next };
      });
    }
    refreshPlaybackEq();
    return result;
  },

  applyPlaylistToTracks: async (playlistId) => {
    const result = await api.applyPlaylistEqToTracks(playlistId);
    const profileId = get().playlistAssignments[playlistId];
    if (profileId != null) {
      const playlist = await api.getPlaylist(playlistId);
      set((state) => {
        const next = { ...state.trackAssignments };
        for (const track of playlist.tracks) {
          if (!track.video_id) continue;
          next[track.video_id] = profileId;
        }
        return { trackAssignments: next };
      });
    }
    refreshPlaybackEq();
    return result;
  },

  clearPlaylistTrackEqs: async (playlistId) => {
    const result = await api.clearPlaylistTrackEqs(playlistId);
    const playlist = await api.getPlaylist(playlistId);
    set((state) => {
      const next = { ...state.trackAssignments };
      for (const track of playlist.tracks) {
        if (!track.video_id) continue;
        delete next[track.video_id];
      }
      return { trackAssignments: next };
    });
    refreshPlaybackEq();
    return result;
  },

  ensurePlaylistAssignment: async (playlistId) => {
    if (get().playlistAssignments[playlistId] != null) return;
    const assignment = await api.getEqPlaylistAssignment(playlistId);
    if (assignment.eq_profile_id != null) {
      set((state) => ({
        playlistAssignments: {
          ...state.playlistAssignments,
          [playlistId]: assignment.eq_profile_id!,
        },
      }));
    }
  },

  ensureTrackAssignment: async (videoId) => {
    if (get().trackAssignments[videoId] != null) return;
    const assignment = await api.getEqTrackAssignment(videoId);
    if (assignment.eq_profile_id != null) {
      set((state) => ({
        trackAssignments: {
          ...state.trackAssignments,
          [videoId]: assignment.eq_profile_id!,
        },
      }));
    }
  },
}));
