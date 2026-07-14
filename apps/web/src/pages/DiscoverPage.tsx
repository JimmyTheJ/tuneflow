import { Loader2, Sparkles } from "lucide-react";

import { TrackRow } from "@/components/TrackRow";
import { Card } from "@/components/ui/Card";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { Skeleton, TrackRowSkeleton } from "@/components/ui/Skeleton";
import { useDiscoverData } from "@/hooks/useDiscoverData";
import { useAuthStore } from "@/stores/authStore";
import { usePlayerStore } from "@/stores/playerStore";

export function DiscoverPage() {
  const userId = useAuthStore((s) => s.user?.id);
  const { status, insights, recommendations, error, loading, refreshing } = useDiscoverData(userId);
  const playTrack = usePlayerStore((s) => s.playTrack);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="m-0 text-3xl font-bold tracking-tight md:text-4xl">Discover</h1>
        <p className="mt-2 text-text-secondary">Personalized insights from your listening history</p>
        {refreshing ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="size-4 animate-spin text-accent" />
            Updating recommendations…
          </p>
        ) : null}
      </div>

      {error ? <p className="text-danger-fg">{error}</p> : null}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-36 w-full rounded-xl" />
          <div className="space-y-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <TrackRowSkeleton key={i} />
            ))}
          </div>
        </div>
      ) : null}

      {status ? (
        <Card>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
              <Sparkles className="size-5" />
            </div>
            <div>
              <h3 className="m-0 text-base font-bold">AI status</h3>
              <p className="mt-1 mb-0 text-sm text-text-secondary">
                {status.reachable
                  ? `Connected to ${status.model}`
                  : (status.detail ?? "LLM not reachable — check LLM_BASE_URL on the server")}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {insights ? (
        <Card>
          <h3 className="m-0 text-base font-bold">Your listening</h3>
          <p className="mt-2 mb-0 leading-relaxed">{insights.summary}</p>
          {insights.top_artists.length > 0 ? (
            <p className="mt-3 mb-0 text-sm text-text-secondary">
              Top artists: {insights.top_artists.join(", ")}
            </p>
          ) : null}
        </Card>
      ) : null}

      {recommendations?.suggestions.map((s) => (
        <section key={s.query}>
          <SectionHeader title={s.reason} />
          <Card className="!p-2">
            <div className="space-y-0.5">
              {s.tracks.map((track) => (
                <TrackRow
                  key={track.video_id}
                  track={track}
                  onClick={() => void playTrack(track, s.tracks)}
                />
              ))}
            </div>
          </Card>
        </section>
      ))}
    </div>
  );
}
