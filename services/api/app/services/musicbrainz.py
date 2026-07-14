"""MusicBrainz API client for artist discography metadata."""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Any

import httpx

from app.config import settings

MB_BASE_URL = "https://musicbrainz.org/ws/2"
CAA_BASE_URL = "https://coverartarchive.org"

_USER_AGENT = "TuneFlow/0.3.0 ( https://github.com/tuneflow )"
_RATE_LIMIT_SEC = 1.05
_CACHE_TTL_SEC = 7 * 24 * 3600


@dataclass
class ArtistSearchHit:
    mbid: str
    name: str
    type: str | None
    score: int
    disambiguation: str | None
    image_url: str | None = None


@dataclass
class ReleaseSummary:
    mbid: str
    title: str
    release_type: str
    release_date: str | None
    cover_url: str | None
    track_count: int | None = None


@dataclass
class CatalogTrack:
    position: int
    title: str
    recording_mbid: str | None
    duration_ms: int | None
    artist_name: str | None = None


@dataclass
class ArtistDetail:
    mbid: str
    name: str
    type: str | None
    disambiguation: str | None
    image_url: str | None
    albums: list[ReleaseSummary]
    eps: list[ReleaseSummary]
    singles: list[ReleaseSummary]


@dataclass
class AlbumDetail:
    mbid: str
    title: str
    artist_name: str
    artist_mbid: str | None
    release_date: str | None
    release_type: str | None
    cover_url: str | None
    tracks: list[CatalogTrack]


def cover_art_url(release_mbid: str, size: str = "front-250") -> str:
    return f"{CAA_BASE_URL}/release/{release_mbid}/{size}"


def _parse_date(value: str | None) -> str | None:
    if not value:
        return None
    return value[:4] if len(value) >= 4 else value


def _release_sort_key(release: ReleaseSummary) -> tuple[str, str]:
    return (release.release_date or "0000", release.title.lower())


class MusicBrainzClient:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._last_request_at = 0.0
        self._memory_cache: dict[str, tuple[float, Any]] = {}

    def _cache_get(self, key: str) -> Any | None:
        entry = self._memory_cache.get(key)
        if not entry:
            return None
        cached_at, payload = entry
        if time.monotonic() - cached_at > _CACHE_TTL_SEC:
            self._memory_cache.pop(key, None)
            return None
        return payload

    def _cache_set(self, key: str, payload: Any) -> None:
        self._memory_cache[key] = (time.monotonic(), payload)

    async def _request(self, path: str, *, params: dict[str, str] | None = None) -> dict:
        cache_key = f"{path}?{json.dumps(params or {}, sort_keys=True)}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        async with self._lock:
            elapsed = time.monotonic() - self._last_request_at
            if elapsed < _RATE_LIMIT_SEC:
                await asyncio.sleep(_RATE_LIMIT_SEC - elapsed)

            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.get(
                    f"{MB_BASE_URL}{path}",
                    params=params,
                    headers={"User-Agent": settings.musicbrainz_user_agent or _USER_AGENT, "Accept": "application/json"},
                )
                self._last_request_at = time.monotonic()
                response.raise_for_status()
                payload = response.json()

        self._cache_set(cache_key, payload)
        return payload

    async def search_artists(self, query: str, *, limit: int = 5) -> list[ArtistSearchHit]:
        payload = await self._request(
            "/artist",
            params={"query": query, "fmt": "json", "limit": str(limit)},
        )
        hits: list[ArtistSearchHit] = []
        for item in payload.get("artists", []):
            score = int(item.get("score", 0))
            artist_type = item.get("type")
            if score < 85:
                continue
            if artist_type not in {"Person", "Group", "Orchestra", "Choir"}:
                continue
            hits.append(
                ArtistSearchHit(
                    mbid=item["id"],
                    name=item.get("name", "Unknown"),
                    type=artist_type,
                    score=score,
                    disambiguation=item.get("disambiguation"),
                )
            )
        return hits[:3]

    def _pick_primary_release(self, release_group: dict) -> dict | None:
        releases = release_group.get("releases") or []
        if not releases:
            return None
        official = [r for r in releases if r.get("status") == "Official"]
        pool = official or releases
        return min(pool, key=lambda r: r.get("date") or "9999")

    def _release_group_to_summary(self, rg: dict, primary: dict | None) -> ReleaseSummary | None:
        if not primary:
            return None
        rg_type = (rg.get("primary-type") or "Album").lower()
        return ReleaseSummary(
            mbid=primary["id"],
            title=rg.get("title") or primary.get("title", "Unknown"),
            release_type=rg_type,
            release_date=_parse_date(primary.get("date") or rg.get("first-release-date")),
            cover_url=cover_art_url(primary["id"]),
            track_count=primary.get("track-count"),
        )

    async def get_artist_detail(self, mbid: str) -> ArtistDetail:
        cache_key = f"artist_detail:{mbid}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        artist_payload = await self._request(
            f"/artist/{mbid}",
            params={"fmt": "json", "inc": "release-groups"},
        )
        rg_payload = await self._request(
            "/release-group",
            params={
                "artist": mbid,
                "type": "album|ep|single",
                "fmt": "json",
                "inc": "releases",
                "limit": "100",
            },
        )

        albums: list[ReleaseSummary] = []
        eps: list[ReleaseSummary] = []
        singles: list[ReleaseSummary] = []

        for rg in rg_payload.get("release-groups", []):
            primary_type = (rg.get("primary-type") or "").lower()
            secondary = {t.lower() for t in (rg.get("secondary-types") or [])}
            if "compilation" in secondary or "live" in secondary:
                continue
            primary = self._pick_primary_release(rg)
            summary = self._release_group_to_summary(rg, primary)
            if not summary:
                continue
            if primary_type == "album":
                albums.append(summary)
            elif primary_type == "ep":
                eps.append(summary)
            elif primary_type == "single":
                singles.append(summary)

        albums.sort(key=_release_sort_key, reverse=True)
        eps.sort(key=_release_sort_key, reverse=True)
        singles.sort(key=_release_sort_key, reverse=True)

        image_url = albums[0].cover_url if albums else (eps[0].cover_url if eps else None)

        detail = ArtistDetail(
            mbid=artist_payload["id"],
            name=artist_payload.get("name", "Unknown"),
            type=artist_payload.get("type"),
            disambiguation=artist_payload.get("disambiguation"),
            image_url=image_url,
            albums=albums,
            eps=eps,
            singles=singles,
        )
        self._cache_set(cache_key, detail)
        return detail

    async def get_album_detail(self, release_mbid: str) -> AlbumDetail:
        cache_key = f"album_detail:{release_mbid}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        payload = await self._request(
            f"/release/{release_mbid}",
            params={"fmt": "json", "inc": "recordings+artist-credits+media+release-groups"},
        )

        artist_name = "Unknown"
        artist_mbid: str | None = None
        credits = payload.get("artist-credit") or []
        if credits:
            artist_name = credits[0].get("name") or credits[0].get("artist", {}).get("name", artist_name)
            artist_mbid = credits[0].get("artist", {}).get("id")

        tracks: list[CatalogTrack] = []
        position = 0
        for medium in sorted(payload.get("media", []), key=lambda m: m.get("position", 1)):
            for track in medium.get("tracks", []):
                position += 1
                recording = track.get("recording") or {}
                length = recording.get("length") or track.get("length")
                tracks.append(
                    CatalogTrack(
                        position=position,
                        title=recording.get("title") or track.get("title", "Unknown"),
                        recording_mbid=recording.get("id"),
                        duration_ms=length,
                        artist_name=artist_name,
                    )
                )

        rg = payload.get("release-group") or {}
        detail = AlbumDetail(
            mbid=payload["id"],
            title=payload.get("title", "Unknown"),
            artist_name=artist_name,
            artist_mbid=artist_mbid,
            release_date=_parse_date(payload.get("date") or rg.get("first-release-date")),
            release_type=(rg.get("primary-type") or payload.get("status")),
            cover_url=cover_art_url(payload["id"]),
            tracks=tracks,
        )
        self._cache_set(cache_key, detail)
        return detail


musicbrainz_client = MusicBrainzClient()
