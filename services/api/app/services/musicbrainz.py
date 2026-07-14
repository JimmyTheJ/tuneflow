"""MusicBrainz API client for artist discography metadata."""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from dataclasses import asdict, dataclass
from typing import Any

import httpx

from app.config import settings
from app.services.catalog_cache import CATALOG_CACHE_TTL_SEC, get_catalog_cache, set_catalog_cache

MB_BASE_URL = "https://musicbrainz.org/ws/2"
CAA_BASE_URL = "https://coverartarchive.org"

_USER_AGENT = "TuneFlow/0.3.0 ( https://github.com/tuneflow )"
_RATE_LIMIT_SEC = 1.05
_CACHE_TTL_SEC = CATALOG_CACHE_TTL_SEC


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


def _serialize_cache_payload(payload: Any) -> str:
    if isinstance(payload, (ArtistDetail, AlbumDetail)):
        return json.dumps(asdict(payload))
    return json.dumps(payload)


def _deserialize_cache_payload(key: str, raw: str) -> Any:
    data = json.loads(raw)
    if key.startswith("artist_detail:"):
        return ArtistDetail(
            mbid=data["mbid"],
            name=data["name"],
            type=data.get("type"),
            disambiguation=data.get("disambiguation"),
            image_url=data.get("image_url"),
            albums=[ReleaseSummary(**item) for item in data.get("albums", [])],
            eps=[ReleaseSummary(**item) for item in data.get("eps", [])],
            singles=[ReleaseSummary(**item) for item in data.get("singles", [])],
        )
    if key.startswith("album_detail:"):
        return AlbumDetail(
            mbid=data["mbid"],
            title=data["title"],
            artist_name=data["artist_name"],
            artist_mbid=data.get("artist_mbid"),
            release_date=data.get("release_date"),
            release_type=data.get("release_type"),
            cover_url=data.get("cover_url"),
            tracks=[CatalogTrack(**item) for item in data.get("tracks", [])],
        )
    return data


class MusicBrainzClient:
    def __init__(self) -> None:
        self._lock = asyncio.Lock()
        self._last_request_at = 0.0
        self._memory_cache: dict[str, tuple[float, Any]] = {}

    async def _cache_get(self, key: str) -> Any | None:
        entry = self._memory_cache.get(key)
        if entry:
            cached_at, payload = entry
            if time.monotonic() - cached_at <= _CACHE_TTL_SEC:
                return payload
            self._memory_cache.pop(key, None)

        raw = await get_catalog_cache(key)
        if raw is None:
            return None
        try:
            payload = _deserialize_cache_payload(key, raw)
        except (json.JSONDecodeError, KeyError, TypeError):
            return None
        self._memory_cache[key] = (time.monotonic(), payload)
        return payload

    async def _cache_set(self, key: str, payload: Any) -> None:
        self._memory_cache[key] = (time.monotonic(), payload)
        await set_catalog_cache(key, _serialize_cache_payload(payload))

    async def _request(self, path: str, *, params: dict[str, str] | None = None) -> dict:
        cache_key = f"{path}?{json.dumps(params or {}, sort_keys=True)}"
        cached = await self._cache_get(cache_key)
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

        await self._cache_set(cache_key, payload)
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

    def _release_is_better(self, candidate: dict, current: dict) -> bool:
        cand_official = candidate.get("status") == "Official"
        curr_official = current.get("status") == "Official"
        if cand_official and not curr_official:
            return True
        if curr_official and not cand_official:
            return False
        return (candidate.get("date") or "9999") < (current.get("date") or "9999")

    def _release_to_summary(self, rg: dict, release: dict) -> ReleaseSummary:
        rg_type = (rg.get("primary-type") or "Album").lower()
        return ReleaseSummary(
            mbid=release["id"],
            title=rg.get("title") or release.get("title", "Unknown"),
            release_type=rg_type,
            release_date=_parse_date(release.get("date") or rg.get("first-release-date")),
            cover_url=cover_art_url(release["id"]),
            track_count=release.get("track-count"),
        )

    def _should_skip_release_group(self, rg: dict) -> bool:
        secondary = {t.lower() for t in (rg.get("secondary-types") or [])}
        if "compilation" in secondary or "live" in secondary:
            return True
        primary_type = (rg.get("primary-type") or "").lower()
        return primary_type not in {"album", "ep", "single"}

    def _categorize_summary(self, rg: dict) -> str | None:
        primary_type = (rg.get("primary-type") or "").lower()
        if primary_type in {"album", "ep", "single"}:
            return primary_type
        return None

    def _profile_from_artist_payload(self, artist_payload: dict) -> dict[str, Any]:
        return {
            "mbid": artist_payload["id"],
            "name": artist_payload.get("name", "Unknown"),
            "type": artist_payload.get("type"),
            "disambiguation": artist_payload.get("disambiguation"),
            "image_url": None,
        }

    def _build_artist_detail(
        self,
        profile: dict[str, Any],
        by_release_group: dict[str, tuple[dict, dict]],
    ) -> ArtistDetail:
        albums: list[ReleaseSummary] = []
        eps: list[ReleaseSummary] = []
        singles: list[ReleaseSummary] = []

        for rg, release in by_release_group.values():
            primary_type = (rg.get("primary-type") or "").lower()
            summary = self._release_to_summary(rg, release)
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

        return ArtistDetail(
            mbid=profile["mbid"],
            name=profile["name"],
            type=profile.get("type"),
            disambiguation=profile.get("disambiguation"),
            image_url=image_url,
            albums=albums,
            eps=eps,
            singles=singles,
        )

    async def stream_artist_detail(self, mbid: str) -> AsyncIterator[dict[str, Any]]:
        cache_key = f"artist_detail:{mbid}"
        cached = await self._cache_get(cache_key)
        if cached is not None:
            yield {
                "event": "profile",
                "data": {
                    "mbid": cached.mbid,
                    "name": cached.name,
                    "type": cached.type,
                    "disambiguation": cached.disambiguation,
                    "image_url": cached.image_url,
                },
            }
            yield {
                "event": "chunk",
                "data": {
                    "albums": [r.__dict__ for r in cached.albums],
                    "eps": [r.__dict__ for r in cached.eps],
                    "singles": [r.__dict__ for r in cached.singles],
                },
            }
            yield {"event": "done", "data": {"image_url": cached.image_url}}
            return

        artist_payload = await self._request(
            f"/artist/{mbid}",
            params={"fmt": "json"},
        )
        profile = self._profile_from_artist_payload(artist_payload)
        yield {"event": "profile", "data": profile}

        by_release_group: dict[str, tuple[dict, dict]] = {}
        offset = 0
        while True:
            release_payload = await self._request(
                "/release",
                params={
                    "artist": mbid,
                    "type": "album|ep|single",
                    "fmt": "json",
                    "inc": "release-groups",
                    "limit": "100",
                    "offset": str(offset),
                },
            )
            releases = release_payload.get("releases", [])
            if not releases:
                break

            chunk_albums: list[ReleaseSummary] = []
            chunk_eps: list[ReleaseSummary] = []
            chunk_singles: list[ReleaseSummary] = []

            for release in releases:
                rg = release.get("release-group") or {}
                rg_id = rg.get("id")
                if not rg_id or self._should_skip_release_group(rg):
                    continue
                existing = by_release_group.get(rg_id)
                if existing is None:
                    by_release_group[rg_id] = (rg, release)
                    summary = self._release_to_summary(rg, release)
                    category = self._categorize_summary(rg)
                    if category == "album":
                        chunk_albums.append(summary)
                    elif category == "ep":
                        chunk_eps.append(summary)
                    elif category == "single":
                        chunk_singles.append(summary)
                elif self._release_is_better(release, existing[1]):
                    by_release_group[rg_id] = (rg, release)

            if chunk_albums or chunk_eps or chunk_singles:
                yield {
                    "event": "chunk",
                    "data": {
                        "albums": [r.__dict__ for r in chunk_albums],
                        "eps": [r.__dict__ for r in chunk_eps],
                        "singles": [r.__dict__ for r in chunk_singles],
                    },
                }

            offset += len(releases)
            if offset >= release_payload.get("release-count", offset):
                break

        detail = self._build_artist_detail(profile, by_release_group)
        await self._cache_set(cache_key, detail)
        yield {"event": "done", "data": {"image_url": detail.image_url}}

    async def get_artist_detail(self, mbid: str) -> ArtistDetail:
        cache_key = f"artist_detail:{mbid}"
        cached = await self._cache_get(cache_key)
        if cached is not None:
            return cached

        async for _event in self.stream_artist_detail(mbid):
            pass

        cached = await self._cache_get(cache_key)
        if cached is None:
            raise RuntimeError(f"Artist detail missing for {mbid}")
        return cached

    async def get_album_detail(self, release_mbid: str) -> AlbumDetail:
        cache_key = f"album_detail:{release_mbid}"
        cached = await self._cache_get(cache_key)
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
        await self._cache_set(cache_key, detail)
        return detail


musicbrainz_client = MusicBrainzClient()
