"""Resolve MusicBrainz catalog tracks to playable YouTube results."""

from __future__ import annotations

import asyncio

from app.schemas import SearchResult, TrackRead
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


async def resolve_catalog_track(artist_name: str, track_title: str) -> TrackRead | None:
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


async def resolve_catalog_tracks(
    tracks: list[tuple[str, str]],
    *,
    concurrency: int = 3,
) -> list[TrackRead | None]:
    semaphore = asyncio.Semaphore(concurrency)

    async def resolve_one(artist: str, title: str) -> TrackRead | None:
        async with semaphore:
            return await resolve_catalog_track(artist, title)

    return await asyncio.gather(*(resolve_one(a, t) for a, t in tracks))
