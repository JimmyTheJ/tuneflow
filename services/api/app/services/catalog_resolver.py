"""Resolve MusicBrainz catalog tracks to playable YouTube results."""

from __future__ import annotations

import asyncio
import json

from app.schemas import SearchResult, TrackRead
from app.services.catalog_cache import (
    get_catalog_cache,
    get_catalog_cache_many,
    set_catalog_cache,
    track_resolution_cache_key,
)
from app.services.piped import (
    artist_matches,
    is_topic_upload,
    matches_requested_track,
    piped_client,
    title_matches,
)


def _rank_catalog_match(
    *,
    wanted_title: str,
    wanted_artist: str,
    candidate: SearchResult,
) -> tuple[int, int, int, str]:
    title_score = 2 if title_matches(wanted_title, candidate.title) else 0
    artist_score = 2 if artist_matches(wanted_artist, candidate.artist) else 0
    topic_bonus = 1 if is_topic_upload(candidate.artist) else 0
    exact_bonus = 1 if matches_requested_track(
        wanted_title=wanted_title,
        wanted_artist=wanted_artist,
        candidate_title=candidate.title,
        candidate_artist=candidate.artist,
    ) else 0
    return (exact_bonus + title_score + artist_score + topic_bonus, title_score, artist_score, candidate.title.lower())


def _serialize_resolution(resolution: TrackRead | None) -> str:
    if resolution is None:
        return json.dumps({"found": False})
    return json.dumps(
        {
            "found": True,
            "video_id": resolution.video_id,
            "title": resolution.title,
            "artist": resolution.artist,
            "thumbnail_url": resolution.thumbnail_url,
            "duration_sec": resolution.duration_sec,
        }
    )


def _deserialize_resolution(raw: str) -> TrackRead | None:
    data = json.loads(raw)
    if not data.get("found"):
        return None
    return TrackRead(
        video_id=data["video_id"],
        title=data["title"],
        artist=data.get("artist"),
        thumbnail_url=data.get("thumbnail_url"),
        duration_sec=data.get("duration_sec"),
    )


async def _resolve_catalog_track_uncached(artist_name: str, track_title: str) -> TrackRead | None:
    query = f"{artist_name} {track_title}"
    try:
        results = await piped_client.search(query, limit=15)
    except Exception:
        return None

    if not results:
        return None

    ranked = sorted(
        results,
        key=lambda r: _rank_catalog_match(
            wanted_title=track_title,
            wanted_artist=artist_name,
            candidate=r,
        ),
        reverse=True,
    )
    best = ranked[0]
    rank = _rank_catalog_match(
        wanted_title=track_title,
        wanted_artist=artist_name,
        candidate=best,
    )
    if rank[0] < 2:
        return None

    return TrackRead(
        video_id=best.video_id,
        title=best.title,
        artist=best.artist,
        thumbnail_url=best.thumbnail_url,
        duration_sec=best.duration_sec,
    )


async def resolve_catalog_track(
    artist_name: str,
    track_title: str,
    *,
    recording_mbid: str | None = None,
) -> TrackRead | None:
    key = track_resolution_cache_key(
        artist_name=artist_name,
        track_title=track_title,
        recording_mbid=recording_mbid,
    )
    cached = await get_catalog_cache(key)
    if cached is not None:
        return _deserialize_resolution(cached)

    resolved = await _resolve_catalog_track_uncached(artist_name, track_title)
    await set_catalog_cache(key, _serialize_resolution(resolved))
    return resolved


async def resolve_catalog_tracks(
    tracks: list[tuple[str, str, str | None]],
    *,
    concurrency: int = 3,
) -> list[TrackRead | None]:
    if not tracks:
        return []

    keys = [
        track_resolution_cache_key(artist_name=artist, track_title=title, recording_mbid=recording_mbid)
        for artist, title, recording_mbid in tracks
    ]
    cached_map = await get_catalog_cache_many(keys)
    results: list[TrackRead | None] = [None] * len(tracks)
    pending: list[tuple[int, str, str, str | None, str]] = []

    for index, ((artist, title, recording_mbid), key) in enumerate(zip(tracks, keys, strict=True)):
        raw = cached_map.get(key)
        if raw is not None:
            results[index] = _deserialize_resolution(raw)
        else:
            pending.append((index, artist, title, recording_mbid, key))

    if not pending:
        return results

    semaphore = asyncio.Semaphore(concurrency)

    async def resolve_one(
        index: int,
        artist: str,
        title: str,
        recording_mbid: str | None,
        key: str,
    ) -> tuple[int, TrackRead | None]:
        async with semaphore:
            resolved = await _resolve_catalog_track_uncached(artist, title)
        await set_catalog_cache(key, _serialize_resolution(resolved))
        return index, resolved

    resolved_pairs = await asyncio.gather(
        *(resolve_one(index, artist, title, recording_mbid, key) for index, artist, title, recording_mbid, key in pending)
    )
    for index, resolved in resolved_pairs:
        results[index] = resolved

    return results
