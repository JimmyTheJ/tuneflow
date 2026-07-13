import { Play } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { TrackThumb } from "@/components/TrackThumb";
import { cn } from "@/lib/cn";

type Props = {
  title: string;
  subtitle?: string;
  videoId?: string;
  cover?: ReactNode;
  href?: string;
  onPlay?: () => void;
  onClick?: () => void;
  className?: string;
  accent?: boolean;
};

export function MediaCard({
  title,
  subtitle,
  videoId,
  cover,
  href,
  onPlay,
  onClick,
  className,
  accent = false,
}: Props) {
  const body = (
    <>
      <div className="relative aspect-square w-full overflow-hidden rounded-lg">
        {cover ? (
          cover
        ) : videoId ? (
          <TrackThumb videoId={videoId} className="size-full" fallbackClassName="size-full" />
        ) : (
          <div
            className={cn(
              "flex size-full items-center justify-center",
              accent
                ? "bg-gradient-to-br from-violet-600 via-purple-700 to-indigo-900"
                : "bg-gradient-to-br from-highlight to-hover",
            )}
          />
        )}
        {onPlay ? (
          <button
            type="button"
            aria-label={`Play ${title}`}
            className={cn(
              "absolute bottom-2 right-2 inline-flex size-11 items-center justify-center rounded-full",
              "bg-accent text-accent-fg shadow-card transition-all duration-200 border-0 cursor-pointer",
              "translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100",
              "hover:scale-105 hover:bg-accent-hover",
            )}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onPlay();
            }}
          >
            <Play className="size-5 translate-x-0.5" fill="currentColor" />
          </button>
        ) : null}
      </div>
      <div className="min-w-0 px-0.5">
        <div className="truncate font-semibold text-text">{title}</div>
        {subtitle ? (
          <div className="mt-0.5 truncate text-sm text-text-secondary">{subtitle}</div>
        ) : null}
      </div>
    </>
  );

  const shellClass = cn(
    "group flex w-full flex-col gap-3 rounded-xl p-3 text-left transition-all duration-200",
    "bg-elevated hover:bg-highlight hover:-translate-y-0.5 shadow-sm hover:shadow-card",
    className,
  );

  if (href) {
    return (
      <Link to={href} className={shellClass} onClick={onClick}>
        {body}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick ?? onPlay} className={cn(shellClass, "border-0 cursor-pointer")}>
      {body}
    </button>
  );
}
