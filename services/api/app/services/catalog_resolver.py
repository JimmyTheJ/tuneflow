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
    looks_like_live_version,
    matches_requested_track,
    parse_artist_title,
    piped_client,
    studio_quality_score,
    title_matches,
)
from app.services.thumbnails import youtube_thumbnail_url


def _duration_score(wanted_ms: int | None, candidate_sec: int | None) -> int:
    if not wanted_ms or not candidate_sec:
        return 0
    wanted_sec = wanted_ms / 1000
    diff = abs(wanted_sec - candidate_sec)
    ratio = diff / max(wanted_sec, candidate_sec, 1)
    if ratio <= 0.08:
        return 3
    if ratio <= 0.18:
        return 2
    if ratio <= 0.35:
        return 1
    return 0


def _rank_catalog_match(
    *,
    wanted_title: str,
    wanted_artist: str,
    candidate: SearchResult,
    wanted_duration_ms: int | None = None,
) -> tuple[int, int, int, int, int, str]:
    title_score = 2 if title_matches(wanted_title, candidate.title) else 0
    artist_score = 2 if artist_matches(wanted_artist, candidate.artist) else 0
    topic_bonus = 1 if is_topic_upload(candidate.artist) else 0
    exact_bonus = 1 if matches_requested_track(
        wanted_title=wanted_title,
        wanted_artist=wanted_artist,
        candidate_title=candidate.title,
        candidate_artist=candidate.artist,
    ) else 0
    prefer_studio = not looks_like_live_version(wanted_title)
    live_penalty = (
        0
        if prefer_studio and looks_like_live_version(candidate.source_title, candidate.title)
        else 1
    )
    duration_bonus = _duration_score(wanted_duration_ms, candidate.duration_sec)
    quality_bonus = studio_quality_score(
        candidate,
        wanted_title=wanted_title,
        wanted_artist=wanted_artist,
        wanted_duration_ms=wanted_duration_ms,
    )
    return (
        exact_bonus + title_score + artist_score + topic_bonus + live_penalty + duration_bonus + quality_bonus,
        title_score,
        quality_bonus,
        duration_bonus,
        artist_score,
        candidate.title.lower(),
    )


def _is_acceptable_match(rank: tuple[int, int, int, int, int, str], *, require_artist: bool = True) -> bool:
    if rank[1] < 2:
        return False
    if require_artist and rank[4] < 2:
        return False
    return True


def _resolution_queries(artist_name: str, track_title: str, album_title: str | None = None) -> list[str]:
    queries = [_build_search_query(artist_name, track_title, album_title)]
    if album_title:
        queries.append(_build_search_query(artist_name, track_title))
    queries.append(f"{artist_name} {track_title} official audio")
    seen: set[str] = set()
    ordered: list[str] = []
    for query in queries:
        normalized = query.strip().lower()
        if normalized and normalized not in seen:
            seen.add(normalized)
            ordered.append(query.strip())
    return ordered


def _build_search_query(artist_name: str, track_title: str, album_title: str | None = None) -> str:
    parts = [artist_name, track_title]
    if album_title:
        parts.append(album_title)
    return " ".join(part for part in parts if part).strip()


def _dedupe_results(results: list[SearchResult]) -> list[SearchResult]:
    seen: set[str] = set()
    deduped: list[SearchResult] = []
    for result in results:
        if result.video_id in seen:
            continue
        seen.add(result.video_id)
        deduped.append(result)
    return deduped


def _pick_best_match(
    results: list[SearchResult],
    *,
    wanted_title: str,
    wanted_artist: str,
    wanted_duration_ms: int | None = None,
) -> SearchResult | None:
    if not results:
        return None

    ranked = sorted(
        _dedupe_results(results),
        key=lambda r: _rank_catalog_match(
            wanted_title=wanted_title,
            wanted_artist=wanted_artist,
            candidate=r,
            wanted_duration_ms=wanted_duration_ms,
        ),
        reverse=True,
    )
    for candidate in ranked:
        rank = _rank_catalog_match(
            wanted_title=wanted_title,
            wanted_artist=wanted_artist,
            candidate=candidate,
            wanted_duration_ms=wanted_duration_ms,
        )
        if _is_acceptable_match(rank):
            return candidate
    return None


async def _ytdlp_search_stubs(query: str, *, limit: int = 15) -> list[SearchResult]:
    from app.services.ytdlp import search_video_entries

    try:
        entries = await search_video_entries(query, limit=limit)
    except Exception:
        return []

    results: list[SearchResult] = []
    for entry in entries:
        video_id = entry.get("id")
        if not video_id:
            continue
        raw_title = (entry.get("title") or "").strip()
        parsed_artist, parsed_title = parse_artist_title(raw_title)
        uploader = entry.get("uploader") or entry.get("channel") or parsed_artist
        results.append(
            SearchResult(
                video_id=video_id,
                title=parsed_title or raw_title,
                artist=uploader,
                thumbnail_url=youtube_thumbnail_url(video_id),
                duration_sec=entry.get("duration"),
                source_title=raw_title or None,
            )
        )
    return results


async def _search_all_sources(
    query: str,
    *,
    wanted_title: str,
    wanted_artist: str,
) -> list[SearchResult]:
    piped_task = asyncio.create_task(piped_client.search(query, limit=15))
    ytdlp_task = asyncio.create_task(_ytdlp_search_stubs(query, limit=15))

    collected: list[SearchResult] = []
    for task in (piped_task, ytdlp_task):
        try:
            collected.extend(await task)
        except Exception:
            continue
    return collected


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


def _to_track_read(result: SearchResult) -> TrackRead:
    return TrackRead(
        video_id=result.video_id,
        title=result.title,
        artist=result.artist,
        thumbnail_url=result.thumbnail_url,
        duration_sec=result.duration_sec,
    )


async def _resolve_catalog_track_uncached(
    artist_name: str,
    track_title: str,
    *,
    duration_ms: int | None = None,
    album_title: str | None = None,
) -> TrackRead | None:
    collected: list[SearchResult] = []
    for query in _resolution_queries(artist_name, track_title, album_title):
        collected.extend(await _search_all_sources(query, wanted_title=track_title, wanted_artist=artist_name))

    best = _pick_best_match(
        collected,
        wanted_title=track_title,
        wanted_artist=artist_name,
        wanted_duration_ms=duration_ms,
    )
    if best is None:
        return None
    return _to_track_read(best)


async def resolve_catalog_track(
    artist_name: str,
    track_title: str,
    *,
    recording_mbid: str | None = None,
    duration_ms: int | None = None,
    album_title: str | None = None,
) -> TrackRead | None:
    key = track_resolution_cache_key(
        artist_name=artist_name,
        track_title=track_title,
        recording_mbid=recording_mbid,
    )
    cached = await get_catalog_cache(key)
    if cached is not None:
        return _deserialize_resolution(cached)

    resolved = await _resolve_catalog_track_uncached(
        artist_name,
        track_title,
        duration_ms=duration_ms,
        album_title=album_title,
    )
    await set_catalog_cache(key, _serialize_resolution(resolved))
    return resolved


async def resolve_catalog_tracks(
    tracks: list[tuple[str, str, str | None, int | None]],
    *,
    album_title: str | None = None,
    concurrency: int = 3,
) -> list[TrackRead | None]:
    if not tracks:
        return []

    keys = [
        track_resolution_cache_key(artist_name=artist, track_title=title, recording_mbid=recording_mbid)
        for artist, title, recording_mbid, _ in tracks
    ]
    cached_map = await get_catalog_cache_many(keys)
    results: list[TrackRead | None] = [None] * len(tracks)
    pending: list[tuple[int, str, str, str | None, int | None, str]] = []

    for index, ((artist, title, recording_mbid, duration_ms), key) in enumerate(zip(tracks, keys, strict=True)):
        raw = cached_map.get(key)
        if raw is not None:
            results[index] = _deserialize_resolution(raw)
        else:
            pending.append((index, artist, title, recording_mbid, duration_ms, key))

    if not pending:
        return results

    semaphore = asyncio.Semaphore(concurrency)

    async def resolve_one(
        index: int,
        artist: str,
        title: str,
        recording_mbid: str | None,
        duration_ms: int | None,
        key: str,
    ) -> tuple[int, TrackRead | None]:
        async with semaphore:
            resolved = await _resolve_catalog_track_uncached(
                artist,
                title,
                duration_ms=duration_ms,
                album_title=album_title,
            )
        await set_catalog_cache(key, _serialize_resolution(resolved))
        return index, resolved

    resolved_pairs = await asyncio.gather(
        *(
            resolve_one(index, artist, title, recording_mbid, duration_ms, key)
            for index, artist, title, recording_mbid, duration_ms, key in pending
        )
    )
    for index, resolved in resolved_pairs:
        results[index] = resolved

    return results
