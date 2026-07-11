import { useEffect, useRef } from "react";
import { usePlayerStore } from "@/stores/playerStore";

type Props = {
  className?: string;
};

export function PlayerVideo({ className }: Props) {
  const media = usePlayerStore((s) => s.media);
  const streamSelection = usePlayerStore((s) => s.streamSelection);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !(media instanceof HTMLVideoElement) || !streamSelection.video) {
      return;
    }

    container.replaceChildren(media);
    return () => {
      if (media.parentElement === container) {
        container.replaceChildren();
      }
    };
  }, [media, streamSelection.video]);

  if (!streamSelection.video || !(media instanceof HTMLVideoElement)) {
    return null;
  }

  return <div ref={containerRef} className={className} />;
}
