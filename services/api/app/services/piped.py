import re

import httpx

from app.config import settings
from app.schemas import SearchResult, StreamInfo
from app.services.thumbnails import youtube_thumbnail_url

_ARTIST_TITLE_RE = re.compile(
    r"^(?P<artist>.+?)\s*[-–—|:]\s*(?P<title>.+?)(?:\s*[\(\[].*[\)\]])?$"
)


def parse_artist_title(raw_title: str) -> tuple[str | None, str]:
    match = _ARTIST_TITLE_RE.match(raw_title.strip())
    if not match:
        return None, raw_title.strip()
    return match.group("artist").strip(), match.group("title").strip()


def collect_playable_audio_streams(payload: dict) -> list[dict]:
    """Return audio-capable streams from a Piped /streams payload.

    YouTube Topic uploads often expose a single combined A/V stream under
    videoStreams (videoOnly=false) with an empty audioStreams list.
    """
    audio_streams = [
        stream
        for stream in payload.get("audioStreams", [])
        if stream.get("url") and not stream.get("videoOnly")
    ]
    if audio_streams:
        return audio_streams

    return [
        stream
        for stream in payload.get("videoStreams", [])
        if stream.get("url") and not stream.get("videoOnly")
    ]


def piped_instance_urls() -> list[str]:
    urls = [settings.piped_base_url, *settings.piped_fallback_urls.split(",")]
    seen: set[str] = set()
    ordered: list[str] = []
    for raw in urls:
        url = raw.strip().rstrip("/")
        if url and url not in seen:
            seen.add(url)
            ordered.append(url)
    return ordered


class PipedClient:
    def __init__(self) -> None:
        self._active_base_url: str | None = None

    @property
    def base_url(self) -> str:
        if self._active_base_url:
            return self._active_base_url
        urls = piped_instance_urls()
        return urls[0] if urls else settings.piped_base_url.rstrip("/")

    async def _request_json(self, path: str, *, params: dict | None = None) -> dict:
        errors: list[str] = []
        for base_url in piped_instance_urls():
            try:
                async with httpx.AsyncClient(timeout=20.0) as client:
                    response = await client.get(f"{base_url}{path}", params=params)
                    response.raise_for_status()
                    self._active_base_url = base_url
                    return response.json()
            except httpx.HTTPError as exc:
                errors.append(f"{base_url}: {exc}")
        detail = "; ".join(errors[:3])
        raise httpx.HTTPError(f"All Piped instances failed. {detail}")

    async def search(self, query: str, limit: int = 20) -> list[SearchResult]:
        payload = await self._request_json("/search", params={"q": query, "filter": "music_songs"})

        results: list[SearchResult] = []
        for item in payload.get("items", [])[:limit]:
            if item.get("type") != "stream":
                continue
            artist, title = parse_artist_title(item.get("title", "Unknown"))
            video_id = item["url"].split("=")[-1]
            results.append(
                SearchResult(
                    video_id=video_id,
                    title=title,
                    artist=artist or item.get("uploaderName"),
                    thumbnail_url=youtube_thumbnail_url(video_id),
                    duration_sec=item.get("duration"),
                )
            )
        return results

    async def get_stream(self, video_id: str) -> StreamInfo:
        payload = await self._request_json(f"/streams/{video_id}")

        audio_streams = collect_playable_audio_streams(payload)
        if not audio_streams:
            raise ValueError("No audio stream available for this video")

        best = max(audio_streams, key=lambda s: s.get("bitrate", 0) or 0)
        artist, title = parse_artist_title(payload.get("title", "Unknown"))

        return StreamInfo(
            video_id=video_id,
            title=title,
            artist=artist or payload.get("uploader"),
            thumbnail_url=youtube_thumbnail_url(video_id),
            duration_sec=payload.get("duration"),
            audio_url=best["url"],
            mime_type=best.get("mimeType") or "audio/webm",
        )


piped_client = PipedClient()
