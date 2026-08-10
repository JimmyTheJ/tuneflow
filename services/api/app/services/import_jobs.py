"""Background playlist import jobs (YouTube + Spotify → YouTube matches)."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select

from app.database import SessionLocal
from app.models import (
    ImportJob,
    ImportJobProvider,
    ImportJobStatus,
    MatchStatus,
    Playlist,
    PlaylistSourceType,
    PlaylistTrack,
    PlaylistVisibility,
)
from app.services.catalog_resolver import resolve_catalog_track
from app.services.spotify import (
    SpotifyNotConfiguredError,
    SpotifyPlaylistError,
    fetch_playlist as fetch_spotify_playlist,
    parse_spotify_playlist_id,
    spotify_configured,
)
from app.services.youtube_playlist import (
    YoutubePlaylistError,
    fetch_playlist as fetch_youtube_playlist,
    parse_youtube_playlist_id,
)

logger = logging.getLogger(__name__)

_running_jobs: set[int] = set()
_resolve_semaphore = asyncio.Semaphore(2)


@dataclass(frozen=True)
class _JobSnapshot:
    id: int
    user_id: int
    provider: ImportJobProvider
    source_url: str | None
    source_external_id: str | None
    requested_name: str | None
    visibility: PlaylistVisibility


def _visibility_from_value(value: str | PlaylistVisibility) -> PlaylistVisibility:
    if isinstance(value, PlaylistVisibility):
        return value
    try:
        return PlaylistVisibility(value)
    except ValueError:
        return PlaylistVisibility.private


async def _set_job(
    job_id: int,
    *,
    status: ImportJobStatus | None = None,
    progress_done: int | None = None,
    progress_total: int | None = None,
    message: str | None = None,
    error: str | None = None,
    result_playlist_id: int | None = None,
    finished: bool = False,
) -> None:
    async with SessionLocal() as db:
        job = await db.get(ImportJob, job_id)
        if job is None:
            return
        if status is not None:
            job.status = status
        if progress_done is not None:
            job.progress_done = progress_done
        if progress_total is not None:
            job.progress_total = progress_total
        if message is not None:
            job.message = message
        if error is not None:
            job.error = error
        if result_playlist_id is not None:
            job.result_playlist_id = result_playlist_id
        if finished:
            job.finished_at = datetime.now(UTC)
        await db.commit()


async def _run_youtube_import(job: _JobSnapshot) -> None:
    playlist_id = job.source_external_id or (
        parse_youtube_playlist_id(job.source_url or "") if job.source_url else None
    )
    if not playlist_id:
        raise YoutubePlaylistError("Could not parse YouTube playlist id")

    await _set_job(job.id, status=ImportJobStatus.running, message="Fetching YouTube playlist…")
    remote = await fetch_youtube_playlist(playlist_id)
    name = (job.requested_name or remote.name).strip() or remote.name
    visibility = _visibility_from_value(job.visibility)

    async with SessionLocal() as db:
        playlist = Playlist(
            user_id=job.user_id,
            name=name[:200],
            description=None,
            visibility=visibility,
            source_type=PlaylistSourceType.youtube,
            source_url=job.source_url,
            source_external_id=playlist_id,
            import_job_id=job.id,
        )
        db.add(playlist)
        await db.flush()

        for entry in remote.entries:
            db.add(
                PlaylistTrack(
                    playlist_id=playlist.id,
                    video_id=entry.video_id,
                    title=entry.title[:500],
                    artist=(entry.artist or None),
                    thumbnail_url=entry.thumbnail_url,
                    duration_sec=entry.duration_sec,
                    position=entry.position,
                    match_status=MatchStatus.matched,
                    source_title=entry.title[:500],
                    source_artist=entry.artist,
                )
            )

        await db.commit()
        result_id = playlist.id

    await _set_job(
        job.id,
        status=ImportJobStatus.completed,
        progress_done=len(remote.entries),
        progress_total=len(remote.entries),
        message=f"Imported {len(remote.entries)} tracks",
        result_playlist_id=result_id,
        finished=True,
    )


async def _run_spotify_import(job: _JobSnapshot) -> None:
    if not spotify_configured():
        raise SpotifyNotConfiguredError("Spotify is not configured on this server")

    playlist_id = job.source_external_id or (
        parse_spotify_playlist_id(job.source_url or "") if job.source_url else None
    )
    if not playlist_id:
        raise SpotifyPlaylistError("Could not parse Spotify playlist id")

    await _set_job(job.id, status=ImportJobStatus.running, message="Fetching Spotify playlist…")
    remote = await fetch_spotify_playlist(playlist_id)
    name = (job.requested_name or remote.name).strip() or remote.name
    visibility = _visibility_from_value(job.visibility)
    total = len(remote.tracks)

    async with SessionLocal() as db:
        playlist = Playlist(
            user_id=job.user_id,
            name=name[:200],
            description=(remote.description or None),
            visibility=visibility,
            source_type=PlaylistSourceType.spotify,
            source_url=job.source_url,
            source_external_id=playlist_id,
            import_job_id=job.id,
        )
        db.add(playlist)
        await db.flush()

        track_rows: list[PlaylistTrack] = []
        for entry in remote.tracks:
            row = PlaylistTrack(
                playlist_id=playlist.id,
                video_id=None,
                title=entry.title[:500],
                artist=entry.artist[:300] if entry.artist else None,
                thumbnail_url=None,
                duration_sec=int(entry.duration_ms / 1000) if entry.duration_ms else None,
                position=entry.position,
                match_status=MatchStatus.pending,
                source_title=entry.title[:500],
                source_artist=entry.artist[:300] if entry.artist else None,
                source_duration_ms=entry.duration_ms,
                source_spotify_id=entry.spotify_id,
            )
            db.add(row)
            track_rows.append(row)

        await db.commit()
        for row in track_rows:
            await db.refresh(row)
        result_id = playlist.id
        track_ids = [row.id for row in track_rows]

    await _set_job(
        job.id,
        progress_done=0,
        progress_total=total,
        message="Matching tracks on YouTube…",
        result_playlist_id=result_id,
    )

    matched = 0
    unmatched = 0
    for index, track_id in enumerate(track_ids):
        async with SessionLocal() as db:
            track = await db.get(PlaylistTrack, track_id)
            if track is None:
                continue
            artist = track.source_artist or track.artist or ""
            title = track.source_title or track.title
            duration_ms = track.source_duration_ms
            async with _resolve_semaphore:
                resolved = await resolve_catalog_track(
                    artist,
                    title,
                    duration_ms=duration_ms,
                )
            if resolved is not None:
                track.video_id = resolved.video_id
                track.title = resolved.title[:500]
                track.artist = resolved.artist
                track.thumbnail_url = resolved.thumbnail_url
                track.duration_sec = resolved.duration_sec
                track.match_status = MatchStatus.matched
                matched += 1
            else:
                track.match_status = MatchStatus.unmatched
                unmatched += 1
            await db.commit()

        await _set_job(
            job.id,
            progress_done=index + 1,
            progress_total=total,
            message=f"Matched {matched} · unmatched {unmatched}",
        )

    await _set_job(
        job.id,
        status=ImportJobStatus.completed,
        progress_done=total,
        progress_total=total,
        message=f"Done — {matched} matched, {unmatched} unmatched",
        result_playlist_id=result_id,
        finished=True,
    )


async def run_import_job(job_id: int) -> None:
    if job_id in _running_jobs:
        return
    _running_jobs.add(job_id)
    try:
        async with SessionLocal() as db:
            job = await db.get(ImportJob, job_id)
            if job is None:
                return
            snapshot = _JobSnapshot(
                id=job.id,
                user_id=job.user_id,
                provider=job.provider,
                source_url=job.source_url,
                source_external_id=job.source_external_id,
                requested_name=job.requested_name,
                visibility=job.visibility,
            )

        try:
            if snapshot.provider == ImportJobProvider.youtube:
                await _run_youtube_import(snapshot)
            elif snapshot.provider == ImportJobProvider.spotify:
                await _run_spotify_import(snapshot)
            else:
                raise RuntimeError(f"Unknown import provider: {snapshot.provider}")
        except Exception as exc:  # noqa: BLE001
            logger.exception("Import job %s failed", job_id)
            await _set_job(
                job_id,
                status=ImportJobStatus.failed,
                error=str(exc) or "Import failed",
                message="Import failed",
                finished=True,
            )
    finally:
        _running_jobs.discard(job_id)


def schedule_import_job(job_id: int) -> None:
    asyncio.create_task(run_import_job(job_id))


async def get_owned_job(db, job_id: int, user_id: int) -> ImportJob | None:
    result = await db.execute(
        select(ImportJob).where(ImportJob.id == job_id, ImportJob.user_id == user_id)
    )
    return result.scalar_one_or_none()
