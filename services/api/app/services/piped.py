import re

import httpx

from app.config import settings
from app.retry import is_transient_http_error, with_retry
from app.schemas import SearchResult, StreamInfo
from app.services.thumbnails import youtube_thumbnail_url

_ARTIST_TITLE_RE = re.compile(
    r"^(?P<artist>.+?)\s*[-–—|:]\s*(?P<title>.+?)(?:\s*[\(\[].*[\)\]])?$"
)
_LIVE_QUERY_RE = re.compile(r"\blive\b", re.IGNORECASE)
# Prefer markers that mean "live performance", not song titles like "Live and Let Die".
_LIVE_VERSION_RE = re.compile(
    r"("
    r"\blive\s+(at|from|in|on)\b|"
    r"[\(\[][^)\]]*\blive\b[^)\]]*[)\]]|"
    r"[-–—|:]\s*live\b|"
    r"\blive\s*(version|recording|performance|session)\b|"
    r"\bunplugged\b"
    r")",
    re.IGNORECASE,
)


def parse_artist_title(raw_title: str) -> tuple[str | None, str]:
    match = _ARTIST_TITLE_RE.match(raw_title.strip())
    if not match:
        return None, raw_title.strip()
    return match.group("artist").strip(), match.group("title").strip()


def _normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def title_matches(wanted: str, candidate: str) -> bool:
    left = _normalize_text(wanted)
    right = _normalize_text(candidate)
    if not left or not right:
        return False
    return left in right or right in left


def artist_matches(wanted: str | None, candidate: str | None) -> bool:
    if not wanted:
        return True
    if not candidate:
        return False
    left = _normalize_text(wanted.replace("- Topic", ""))
    right = _normalize_text(candidate.replace("- Topic", ""))
    return bool(left and right and (left in right or right in left))


def matches_requested_track(
    *,
    wanted_title: str,
    wanted_artist: str | None,
    candidate_title: str,
    candidate_artist: str | None,
) -> bool:
    if not title_matches(wanted_title, candidate_title):
        return False
    if not wanted_artist:
        return True
    if artist_matches(wanted_artist, candidate_artist):
        return True
    if is_topic_upload(wanted_artist):
        topic_artist = wanted_artist.replace("- Topic", "").strip()
        combined = f"{candidate_title} {candidate_artist or ''}"
        return _normalize_text(topic_artist) in _normalize_text(combined)
    combined = f"{candidate_title} {candidate_artist or ''}"
    return _normalize_text(wanted_artist.replace("- Topic", "").strip()) in _normalize_text(combined)


def is_topic_upload(artist: str | None) -> bool:
    return bool(artist and artist.rstrip().endswith("- Topic"))


def query_requests_live(query: str | None) -> bool:
    return bool(query and _LIVE_QUERY_RE.search(query))


def looks_like_live_version(*parts: str | None) -> bool:
    text = " ".join(part for part in parts if part)
    return bool(text and _LIVE_VERSION_RE.search(text))


def _search_rank_key(result: SearchResult, *, prefer_studio: bool) -> tuple[int, int, str]:
    # Ascending sort. Default: studio before live, Topic before others.
    # If the query asks for live, invert so live versions rank first.
    is_live = looks_like_live_version(result.title)
    if prefer_studio:
        live_rank = 1 if is_live else 0
    else:
        live_rank = 0 if is_live else 1
    non_topic = 0 if is_topic_upload(result.artist) else 1
    return (live_rank, non_topic, result.title.lower())


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


def collect_video_playback_streams(payload: dict) -> list[dict]:
    """Return streams suitable for video playback (combined A/V preferred)."""
    combined = [
        stream
        for stream in payload.get("videoStreams", [])
        if stream.get("url") and not stream.get("videoOnly")
    ]
    if combined:
        return combined

    return [stream for stream in payload.get("videoStreams", []) if stream.get("url")]


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


def _parse_search_items(payload: dict) -> list[SearchResult]:
    results: list[SearchResult] = []
    for item in payload.get("items", []):
        if item.get("type") != "stream":
            continue
        raw_title = (item.get("title") or "Unknown").strip()
        artist, title = parse_artist_title(raw_title)
        video_id = item["url"].split("=")[-1]
        uploader = item.get("uploaderName") or artist
        short_description = item.get("shortDescription")
        if isinstance(short_description, str):
            short_description = short_description.strip() or None
        else:
            short_description = None
        results.append(
            SearchResult(
                video_id=video_id,
                title=title,
                artist=uploader,
                thumbnail_url=youtube_thumbnail_url(video_id),
                duration_sec=item.get("duration"),
                source_title=raw_title,
                short_description=short_description,
            )
        )
    return results


def _next_page_token(payload: dict) -> str | None:
    next_page = payload.get("nextpage")
    if not next_page:
        return None
    return str(next_page)


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

                async def fetch_from_instance() -> dict:
                    async with httpx.AsyncClient(timeout=20.0) as client:
                        response = await client.get(f"{base_url}{path}", params=params)
                        response.raise_for_status()
                        return response.json()

                payload = await with_retry(
                    fetch_from_instance,
                    max_attempts=2,
                    should_retry=is_transient_http_error,
                )
                self._active_base_url = base_url
                return payload
            except httpx.HTTPError as exc:
                errors.append(f"{base_url}: {exc}")
        detail = "; ".join(errors[:3])
        raise httpx.HTTPError(f"All Piped instances failed. {detail}")

    async def search_piped(self, query: str, limit: int = 20) -> tuple[list[SearchResult], str | None]:
        payload = await self._request_json("/search", params={"q": query, "filter": "music_songs"})
        results = _parse_search_items(payload)
        prefer_studio = not query_requests_live(query)
        results.sort(key=lambda result: _search_rank_key(result, prefer_studio=prefer_studio))
        return results[:limit], _next_page_token(payload)

    async def search_piped_next(
        self,
        query: str,
        next_page: str,
        limit: int = 20,
    ) -> tuple[list[SearchResult], str | None]:
        payload = await self._request_json(
            "/nextpage/search",
            params={"q": query, "filter": "music_songs", "nextpage": next_page},
        )
        results = _parse_search_items(payload)
        prefer_studio = not query_requests_live(query)
        results.sort(key=lambda result: _search_rank_key(result, prefer_studio=prefer_studio))
        return results[:limit], _next_page_token(payload)

    async def search(self, query: str, limit: int = 20) -> list[SearchResult]:
        results, _ = await self.search_piped(query, limit=limit)
        return results

    async def get_stream(self, video_id: str) -> StreamInfo:
        payload = await self._request_json(f"/streams/{video_id}")

        audio_streams = collect_playable_audio_streams(payload)
        if not audio_streams:
            raise ValueError("No audio stream available for this video")

        best = max(audio_streams, key=lambda s: s.get("bitrate", 0) or 0)
        artist, title = parse_artist_title(payload.get("title", "Unknown"))
        video_streams = collect_video_playback_streams(payload)
        has_video = bool(video_streams)
        video_mime_type = None
        if video_streams:
            video_best = max(video_streams, key=lambda s: s.get("bitrate", 0) or 0)
            video_mime_type = video_best.get("mimeType") or "video/mp4"

        return StreamInfo(
            video_id=video_id,
            title=title,
            artist=artist or payload.get("uploader"),
            thumbnail_url=youtube_thumbnail_url(video_id),
            duration_sec=payload.get("duration"),
            audio_url=best["url"],
            mime_type=best.get("mimeType") or "audio/webm",
            has_video=has_video,
            video_mime_type=video_mime_type,
        )


piped_client = PipedClient()
