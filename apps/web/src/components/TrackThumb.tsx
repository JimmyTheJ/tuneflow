import { Music2 } from "lucide-react";
import { useEffect, useState } from "react";
import { trackThumbnailUrl } from "@/lib/thumbnails";
import { getAccessToken, getApiUrl } from "@/lib/settings";
import { cn } from "@/lib/cn";

type Props = {
  videoId: string;
  className?: string;
  fallbackClassName?: string;
  alt?: string;
};

export function TrackThumb({ videoId, className, fallbackClassName, alt = "" }: Props) {
  const [failed, setFailed] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const jellyfin = videoId.startsWith("jf_");

  useEffect(() => {
    setFailed(false);
    setImageUrl(null);
    if (!jellyfin) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    void fetch(`${getApiUrl()}/api/library/images/${encodeURIComponent(videoId)}`, {
      headers: { Authorization: `Bearer ${getAccessToken()}` },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Artwork unavailable");
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setImageUrl(objectUrl);
    }).catch(() => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [videoId, jellyfin]);

  if (failed || (jellyfin && !imageUrl)) {
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
      src={jellyfin ? imageUrl ?? "" : trackThumbnailUrl(videoId)}
      alt={alt}
      className={cn("object-cover bg-highlight", className)}
      onError={() => setFailed(true)}
    />
  );
}
