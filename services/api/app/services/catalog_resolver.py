"""Resolve MusicBrainz catalog tracks to playable YouTube results."""

from __future__ import annotations

import asyncio
import json

from app.schemas import SearchResult, StreamInfo, TrackRead
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
    piped_client,
    title_matches,
)


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
) -> tuple[int, int, int, int, str]:
    title_score = 2 if title_matches(wanted_title, candidate.title) else 0
    artist_score = 2 if artist_matches(wanted_artist, candidate.artist) else 0
    topic_bonus = 1 if is_topic_upload(candidate.artist) else 0
    exact_bonus = 1 if matches_requested_track(
        wanted_title=wanted_title,
        wanted_artist=wanted_artist,
        candidate_title=candidate.title,
        candidate_artist=candidate.artist,
    ) else 0
    # Prefer studio uploads unless the catalog title itself is a live recording.
    prefer_studio = not looks_like_live_version(wanted_title)
    studio_bonus = (
        0
        if prefer_studio and looks_like_live_version(candidate.source_title, candidate.title)
        else 1
    )
    duration_bonus = _duration_score(wanted_duration_ms, candidate.duration_sec)
    return (
        exact_bonus + title_score + artist_score + topic_bonus + studio_bonus + duration_bonus,
        title_score,
        duration_bonus,
        artist_score,
        candidate.title.lower(),
    )


def _is_acceptable_match(rank: tuple[int, int, int, int, str], *, require_artist: bool = True) -> bool:
    if rank[1] < 2:
        return False
    if require_artist and rank[3] < 2:
        return False
    return True


def _build_search_query(artist_name: str, track_title: str, album_title: str | None = None) -> str:
    parts = [artist_name, track_title]
    if album_title:
        parts.append(album_title)
    return " ".join(part for part in parts if part).strip()


def _search_result_from_stream(stream: StreamInfo) -> SearchResult:
    return SearchResult(
        video_id=stream.video_id,
        title=stream.title,
        artist=stream.artist,
        thumbnail_url=stream.thumbnail_url,
        duration_sec=stream.duration_sec,
    )


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
    best = ranked[0]
    rank = _rank_catalog_match(
        wanted_title=wanted_title,
        wanted_artist=wanted_artist,
        candidate=best,
        wanted_duration_ms=wanted_duration_ms,
    )
    if not _is_acceptable_match(rank):
        return None
    return best


async def _ytdlp_search_results(
    query: str,
    *,
    limit: int = 10,
    wanted_title: str,
    wanted_artist: str,
    wanted_duration_ms: int | None = None,
) -> list[SearchResult]:
    from app.services.ytdlp import get_stream_via_ytdlp, search_video_entries

    try:
        entries = await search_video_entries(query, limit=limit)
    except Exception:
        return []

    candidates: list[SearchResult] = []
    for entry in entries:
        video_id = entry.get("id")
        if not video_id:
            continue
        title = entry.get("title") or ""
        artist = entry.get("uploader") or entry.get("channel")
        duration_sec = entry.get("duration")
        stub = SearchResult(
            video_id=video_id,
            title=title,
            artist=artist,
            thumbnail_url=None,
            duration_sec=duration_sec,
        )
        rank = _rank_catalog_match(
            wanted_title=wanted_title,
            wanted_artist=wanted_artist,
            candidate=stub,
            wanted_duration_ms=wanted_duration_ms,
        )
        if not _is_acceptable_match(rank):
            continue
        candidates.append((rank, stub))

    candidates.sort(key=lambda item: item[0], reverse=True)

    results: list[SearchResult] = []
    for _, stub in candidates[:5]:
        try:
            stream = await get_stream_via_ytdlp(stub.video_id)
        except Exception:
            continue
        results.append(_search_result_from_stream(stream))
    return results


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
    queries = [_build_search_query(artist_name, track_title, album_title)]
    if album_title:
        queries.append(_build_search_query(artist_name, track_title))

    collected: list[SearchResult] = []
    for query in queries:
        try:
            collected.extend(await piped_client.search(query, limit=15))
        except Exception:
            continue
        best = _pick_best_match(
            collected,
            wanted_title=track_title,
            wanted_artist=artist_name,
            wanted_duration_ms=duration_ms,
        )
        if best is not None:
            return _to_track_read(best)

    for query in queries:
        collected.extend(
            await _ytdlp_search_results(
                query,
                limit=10,
                wanted_title=track_title,
                wanted_artist=artist_name,
                wanted_duration_ms=duration_ms,
            )
        )
        best = _pick_best_match(
            collected,
            wanted_title=track_title,
            wanted_artist=artist_name,
            wanted_duration_ms=duration_ms,
        )
        if best is not None:
            return _to_track_read(best)

    return None


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
