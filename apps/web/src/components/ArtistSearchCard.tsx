import { ChevronRight, User } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn";
import type { ArtistSearchHit } from "@/types";

type Props = {
  artist: ArtistSearchHit;
  className?: string;
};

export function ArtistSearchCard({ artist, className }: Props) {
  return (
    <Link
      to={`/artist/${artist.mbid}`}
      className={cn(
        "group flex items-center gap-4 rounded-xl border border-border bg-elevated p-4 transition-colors hover:bg-highlight",
        className,
      )}
    >
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-highlight">
        {artist.image_url ? (
          <img src={artist.image_url} alt="" className="size-full object-cover" />
        ) : (
          <User className="size-8 text-text-muted" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-xs font-bold uppercase tracking-widest text-accent">Artist</p>
        <p className="m-0 truncate text-lg font-semibold text-text">{artist.name}</p>
        {artist.disambiguation ? (
          <p className="m-0 truncate text-sm text-text-secondary">{artist.disambiguation}</p>
        ) : null}
      </div>
      <ChevronRight className="size-5 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
