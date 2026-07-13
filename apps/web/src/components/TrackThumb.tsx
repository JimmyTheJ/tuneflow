import { Music2 } from "lucide-react";
import { useState } from "react";
import { trackThumbnailUrl } from "@/lib/thumbnails";
import { cn } from "@/lib/cn";

type Props = {
  videoId: string;
  className?: string;
  fallbackClassName?: string;
  alt?: string;
};

export function TrackThumb({ videoId, className, fallbackClassName, alt = "" }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center bg-gradient-to-br from-highlight to-hover text-text-muted",
          fallbackClassName ?? className,
        )}
        aria-hidden={alt ? undefined : true}
      >
        <Music2 className="size-[40%] opacity-60" />
      </div>
    );
  }

  return (
    <img
      src={trackThumbnailUrl(videoId)}
      alt={alt}
      className={cn("object-cover bg-highlight", className)}
      onError={() => setFailed(true)}
    />
  );
}
