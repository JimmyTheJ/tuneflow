import { cloneBands, createFlatBands, curveFromProfile } from "@/lib/eqBands";
import type { EqCurve, EqProfile, QueueSource } from "@/types";

export type EqResolveContext = {
  videoId: string;
  queueSource: QueueSource | null;
  queueEqProfileId: number | null;
  eqBroadcastActive: boolean;
  eqBroadcastSnapshot: EqCurve | null;
  profiles: EqProfile[];
  trackAssignments: Record<string, number>;
  playlistAssignments: Record<number, number>;
};

export type ResolvedEq = EqCurve & {
  source: "broadcast" | "track" | "playlist" | "queue" | "default" | "flat";
  profileId: number | null;
  profileName: string | null;
};

function profileById(profiles: EqProfile[], profileId: number | null): EqProfile | null {
  if (profileId == null) return null;
  return profiles.find((profile) => profile.id === profileId) ?? null;
}

export function resolveActiveEq(context: EqResolveContext): ResolvedEq {
  if (context.eqBroadcastActive && context.eqBroadcastSnapshot) {
    return {
      ...context.eqBroadcastSnapshot,
      bands: cloneBands(context.eqBroadcastSnapshot.bands),
      source: "broadcast",
      profileId: null,
      profileName: "Broadcast",
    };
  }

  const trackProfileId = context.trackAssignments[context.videoId];
  const trackProfile = profileById(context.profiles, trackProfileId ?? null);
  if (trackProfile) {
    return {
      ...curveFromProfile(trackProfile),
      source: "track",
      profileId: trackProfile.id,
      profileName: trackProfile.name,
    };
  }

  if (context.queueSource?.type === "playlist") {
    const playlistProfileId = context.playlistAssignments[context.queueSource.id];
    const playlistProfile = profileById(context.profiles, playlistProfileId ?? null);
    if (playlistProfile) {
      return {
        ...curveFromProfile(playlistProfile),
        source: "playlist",
        profileId: playlistProfile.id,
        profileName: playlistProfile.name,
      };
    }
  }

  const queueProfile = profileById(context.profiles, context.queueEqProfileId);
  if (queueProfile) {
    return {
      ...curveFromProfile(queueProfile),
      source: "queue",
      profileId: queueProfile.id,
      profileName: queueProfile.name,
    };
  }

  const defaultProfile = context.profiles.find((profile) => profile.is_default) ?? null;
  if (defaultProfile) {
    return {
      ...curveFromProfile(defaultProfile),
      source: "default",
      profileId: defaultProfile.id,
      profileName: defaultProfile.name,
    };
  }

  return {
    bands: createFlatBands(),
    preampDb: 0,
    source: "flat",
    profileId: null,
    profileName: null,
  };
}
