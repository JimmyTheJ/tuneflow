import { useState } from "react";
import { trackThumbnailUrl } from "@/lib/thumbnails";

type Props = {
  videoId: string;
  className?: string;
  fallbackClassName?: string;
};

export function TrackThumb({ videoId, className, fallbackClassName }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return <div className={fallbackClassName ?? className} />;
  }

  return (
    <img
      src={trackThumbnailUrl(videoId)}
      alt=""
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
