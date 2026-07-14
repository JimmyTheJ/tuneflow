import { User } from "lucide-react";
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { MediaCard } from "@/components/MediaCard";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { MediaCardSkeleton, Skeleton } from "@/components/ui/Skeleton";
import { api } from "@/lib/api";
import { formatReleaseYear, mergeArtistDiscography } from "@/lib/catalogUtils";
import type { ArtistDetail, ReleaseSummary } from "@/types";

function ReleaseGrid({
  title,
  releases,
  loading,
}: {
  title: string;
  releases: ReleaseSummary[];
  loading: boolean;
}) {
  if (releases.length === 0 && !loading) return null;

  return (
    <section className="space-y-4">
      <SectionHeader title={title} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {releases.map((release) => (
          <MediaCard
            key={release.mbid}
            title={release.title}
            subtitle={formatReleaseYear(release.release_date)}
            href={`/album/${release.mbid}`}
            cover={
              release.cover_url ? (
                <img src={release.cover_url} alt="" className="size-full object-cover" />
              ) : undefined
            }
          />
        ))}
        {loading
          ? Array.from({ length: releases.length === 0 ? 6 : 2 }).map((_, i) => (
              <MediaCardSkeleton key={`loading-${i}`} />
            ))
          : null}
      </div>
    </section>
  );
}

export function ArtistPage() {
  const { id } = useParams<{ id: string }>();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingDiscography, setLoadingDiscography] = useState(true);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;
    setArtist(null);
    setError(null);
    setLoadingProfile(true);
    setLoadingDiscography(true);

    void (async () => {
      try {
        for await (const event of api.streamArtist(id)) {
          if (cancelled) return;

          if (event.event === "profile") {
            setArtist({
              ...event.data,
              albums: [],
              eps: [],
              singles: [],
            });
            setLoadingProfile(false);
          } else if (event.event === "chunk") {
            setArtist((current) => (current ? mergeArtistDiscography(current, event.data) : current));
          } else if (event.event === "done") {
            setArtist((current) =>
              current
                ? { ...current, image_url: event.data.image_url ?? current.image_url }
                : current,
            );
            setLoadingDiscography(false);
          } else if (event.event === "error") {
            throw new Error(event.data.message);
          }
        }
        if (!cancelled) setLoadingDiscography(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load artist");
          setLoadingProfile(false);
          setLoadingDiscography(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (error && !artist) return <p className="text-danger-fg">{error}</p>;

  if (loadingProfile && !artist) {
    return (
      <div className="space-y-6">
        <div className="flex gap-6">
          <Skeleton className="size-48 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col justify-end gap-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-10 w-2/3" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <MediaCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (!artist) return null;

  const totalReleases = artist.albums.length + artist.eps.length + artist.singles.length;

  return (
    <div className="space-y-8">
      <div className="relative -mx-4 -mt-6 overflow-hidden rounded-b-2xl md:-mx-8 md:-mt-8">
        <div className="absolute inset-0 bg-gradient-to-b from-accent-dim/80 via-elevated to-base" />
        <div className="relative flex flex-col gap-6 px-4 py-10 sm:flex-row sm:items-end md:px-8">
          <div className="flex size-48 shrink-0 items-center justify-center overflow-hidden rounded-full bg-highlight shadow-elevated sm:size-52">
            {artist.image_url ? (
              <img src={artist.image_url} alt="" className="size-full object-cover" />
            ) : (
              <User className="size-20 text-text-muted" />
            )}
          </div>
          <div className="min-w-0 flex-1 pb-1">
            <p className="m-0 text-xs font-bold uppercase tracking-widest text-text-secondary">Artist</p>
            <h1 className="m-0 text-4xl font-bold tracking-tight md:text-5xl">{artist.name}</h1>
            {artist.disambiguation ? (
              <p className="m-0 mt-1 text-sm text-text-secondary">{artist.disambiguation}</p>
            ) : null}
            <p className="m-0 mt-2 text-sm text-text-secondary">
              {loadingDiscography && totalReleases === 0
                ? "Loading releases…"
                : `${totalReleases}${loadingDiscography ? "+" : ""} ${totalReleases === 1 ? "release" : "releases"}`}
            </p>
          </div>
        </div>
      </div>

      {error ? <p className="text-danger-fg">{error}</p> : null}

      <ReleaseGrid title="Albums" releases={artist.albums} loading={loadingDiscography} />
      <ReleaseGrid title="EPs" releases={artist.eps} loading={loadingDiscography && artist.albums.length === 0} />
      <ReleaseGrid
        title="Singles"
        releases={artist.singles}
        loading={loadingDiscography && artist.albums.length === 0 && artist.eps.length === 0}
      />

      {!loadingDiscography && totalReleases === 0 ? (
        <p className="text-text-muted">No releases found for this artist.</p>
      ) : null}
    </div>
  );
}
