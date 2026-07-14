import { connectEq, disconnectEq } from "@/lib/eqAudioGraph";
import { resolveActiveEq } from "@/lib/eqResolve";
import { useEqStore } from "@/stores/eqStore";
import { usePlayerStore } from "@/stores/playerStore";
import type { EqBand } from "@/types";

export async function syncEqPlayback(mediaOverride?: HTMLMediaElement | null): Promise<void> {
  const player = usePlayerStore.getState();
  const eq = useEqStore.getState();
  const media = mediaOverride ?? player.media;

  if (!media || !player.current) return;

  if (!eq.enabled) {
    disconnectEq(media);
    media.volume = player.volume;
    if (media instanceof HTMLVideoElement && player.streamSelection.video && !player.streamSelection.audio) {
      media.muted = true;
    }
    return;
  }

  const resolved = resolveActiveEq({
    videoId: player.current.video_id,
    queueSource: player.queueSource,
    queueEqProfileId: player.queueEqProfileId,
    eqBroadcastActive: player.eqBroadcastActive,
    eqBroadcastSnapshot: player.eqBroadcastSnapshot,
    profiles: eq.profiles,
    trackAssignments: eq.trackAssignments,
    playlistAssignments: eq.playlistAssignments,
  });

  await connectEq(media, player.volume, resolved.bands, resolved.preampDb, true);

  if (media instanceof HTMLVideoElement && player.streamSelection.video && !player.streamSelection.audio) {
    media.muted = true;
  }
}

export async function applyEqPreview(bands: EqBand[], preampDb: number): Promise<void> {
  const player = usePlayerStore.getState();
  const eq = useEqStore.getState();
  const media = player.media;
  if (!media || !eq.enabled) return;
  await connectEq(media, player.volume, bands, preampDb, true);
}

export function getResolvedEqForCurrentTrack() {
  const player = usePlayerStore.getState();
  const eq = useEqStore.getState();
  if (!player.current) return null;

  return resolveActiveEq({
    videoId: player.current.video_id,
    queueSource: player.queueSource,
    queueEqProfileId: player.queueEqProfileId,
    eqBroadcastActive: player.eqBroadcastActive,
    eqBroadcastSnapshot: player.eqBroadcastSnapshot,
    profiles: eq.profiles,
    trackAssignments: eq.trackAssignments,
    playlistAssignments: eq.playlistAssignments,
  });
}
