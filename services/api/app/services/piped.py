import re

import httpx

from app.config import settings
from app.schemas import SearchResult, StreamInfo

_ARTIST_TITLE_RE = re.compile(
    r"^(?P<artist>.+?)\s*[-–—|:]\s*(?P<title>.+?)(?:\s*[\(\[].*[\)\]])?$"
)


def parse_artist_title(raw_title: str) -> tuple[str | None, str]:
    match = _ARTIST_TITLE_RE.match(raw_title.strip())
    if not match:
        return None, raw_title.strip()
    return match.group("artist").strip(), match.group("title").strip()


class PipedClient:
    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or settings.piped_base_url).rstrip("/")

    async def search(self, query: str, limit: int = 20) -> list[SearchResult]:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(
                f"{self.base_url}/search",
                params={"q": query, "filter": "music_songs"},
            )
            response.raise_for_status()
            payload = response.json()

        results: list[SearchResult] = []
        for item in payload.get("items", [])[:limit]:
            if item.get("type") != "stream":
                continue
            artist, title = parse_artist_title(item.get("title", "Unknown"))
            results.append(
                SearchResult(
                    video_id=item["url"].split("=")[-1],
                    title=title,
                    artist=artist or item.get("uploaderName"),
                    thumbnail_url=item.get("thumbnail"),
                    duration_sec=item.get("duration"),
                )
            )
        return results

    async def get_stream(self, video_id: str) -> StreamInfo:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.get(f"{self.base_url}/streams/{video_id}")
            response.raise_for_status()
            payload = response.json()

        audio_streams = [
            stream
            for stream in payload.get("audioStreams", [])
            if stream.get("url") and not stream.get("videoOnly")
        ]
        if not audio_streams:
            raise ValueError("No audio stream available for this video")

        best = max(audio_streams, key=lambda s: s.get("bitrate", 0) or 0)
        artist, title = parse_artist_title(payload.get("title", "Unknown"))

        return StreamInfo(
            video_id=video_id,
            title=title,
            artist=artist or payload.get("uploader"),
            thumbnail_url=payload.get("thumbnailUrl"),
            duration_sec=payload.get("duration"),
            audio_url=best["url"],
        )


piped_client = PipedClient()
