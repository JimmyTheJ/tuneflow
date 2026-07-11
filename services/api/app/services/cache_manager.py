import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import AudioCacheAccess, AudioCacheEntry, PlayHistory, SystemSettings, User
from app.services.audio_cache import (
    _AUDIO_SUFFIXES,
    _cache_dir,
    _find_cached_file,
    _guess_mime,
    download_audio_to_cache,
)


@dataclass
class AudioResolution:
    path: Path | None
    mime_type: str
    stream: bool


async def get_system_settings(db: AsyncSession) -> SystemSettings:
    settings = await db.get(SystemSettings, 1)
    if settings is None:
        settings = SystemSettings(id=1)
        db.add(settings)
        await db.commit()
        await db.refresh(settings)
    return settings


def _apply_track_metadata(entry: AudioCacheEntry, *, title: str | None, artist: str | None) -> None:
    if title:
        entry.title = title.strip()
    if artist:
        entry.artist = artist.strip()


async def backfill_missing_titles(db: AsyncSession) -> int:
    entries = (
        await db.execute(select(AudioCacheEntry).where(AudioCacheEntry.title.is_(None)))
    ).scalars().all()
    updated = 0
    for entry in entries:
        history = await db.scalar(
            select(PlayHistory)
            .where(PlayHistory.video_id == entry.video_id)
            .order_by(PlayHistory.played_at.desc())
            .limit(1)
        )
        if history is None:
            continue
        entry.title = history.title
        entry.artist = history.artist
        updated += 1
    if updated:
        await db.commit()
    return updated


async def backfill_orphaned_files(db: AsyncSession) -> int:
    cache_dir = _cache_dir()
    created = 0
    for candidate in cache_dir.glob("*.*"):
        if candidate.suffix.lower() not in _AUDIO_SUFFIXES or candidate.stat().st_size <= 0:
            continue
        video_id = candidate.stem
        existing = await db.scalar(select(AudioCacheEntry).where(AudioCacheEntry.video_id == video_id))
        if existing is not None:
            continue
        mtime = datetime.fromtimestamp(candidate.stat().st_mtime, tz=UTC)
        entry = AudioCacheEntry(
            video_id=video_id,
            file_path=str(candidate),
            file_size_bytes=candidate.stat().st_size,
            mime_type=_guess_mime(candidate),
            cached_at=mtime,
            last_accessed_at=mtime,
            cached_by_user_id=None,
        )
        db.add(entry)
        created += 1
    if created:
        await db.commit()
    return created


async def _record_access(
    db: AsyncSession,
    *,
    user_id: int,
    entry: AudioCacheEntry,
    title: str | None = None,
    artist: str | None = None,
) -> None:
    now = datetime.now(UTC)
    _apply_track_metadata(entry, title=title, artist=artist)
    access = await db.scalar(
        select(AudioCacheAccess).where(
            AudioCacheAccess.user_id == user_id,
            AudioCacheAccess.video_id == entry.video_id,
        )
    )
    if access is None:
        access = AudioCacheAccess(
            user_id=user_id,
            video_id=entry.video_id,
            cache_entry_id=entry.id,
            first_accessed_at=now,
            last_accessed_at=now,
        )
        db.add(access)
    else:
        access.last_accessed_at = now
        access.cache_entry_id = entry.id
    entry.last_accessed_at = now
    await db.commit()


async def resolve_audio(
    db: AsyncSession,
    *,
    video_id: str,
    user_id: int,
    title: str | None = None,
    artist: str | None = None,
) -> AudioResolution:
    settings = await get_system_settings(db)
    if not settings.cache_enabled or settings.cache_retention_days == 0:
        return AudioResolution(path=None, mime_type="audio/webm", stream=True)

    cache_dir = _cache_dir()
    entry = await db.scalar(select(AudioCacheEntry).where(AudioCacheEntry.video_id == video_id))

    if entry is not None:
        path = Path(entry.file_path)
        if path.exists() and path.stat().st_size > 0:
            await _record_access(db, user_id=user_id, entry=entry, title=title, artist=artist)
            return AudioResolution(path=path, mime_type=entry.mime_type, stream=False)
        await db.delete(entry)
        await db.commit()

    existing_file = await asyncio.to_thread(_find_cached_file, cache_dir, video_id)
    if existing_file is not None:
        entry = await _upsert_entry_from_file(
            db,
            video_id=video_id,
            path=existing_file,
            cached_by_user_id=user_id,
            title=title,
            artist=artist,
        )
        await _record_access(db, user_id=user_id, entry=entry, title=title, artist=artist)
        return AudioResolution(path=existing_file, mime_type=entry.mime_type, stream=False)

    path = await download_audio_to_cache(video_id)
    entry = await _upsert_entry_from_file(
        db,
        video_id=video_id,
        path=path,
        cached_by_user_id=user_id,
        title=title,
        artist=artist,
    )
    await _record_access(db, user_id=user_id, entry=entry, title=title, artist=artist)
    return AudioResolution(path=path, mime_type=entry.mime_type, stream=False)


async def _upsert_entry_from_file(
    db: AsyncSession,
    *,
    video_id: str,
    path: Path,
    cached_by_user_id: int,
    title: str | None = None,
    artist: str | None = None,
) -> AudioCacheEntry:
    now = datetime.now(UTC)
    size = path.stat().st_size
    mime = _guess_mime(path)
    entry = await db.scalar(select(AudioCacheEntry).where(AudioCacheEntry.video_id == video_id))
    if entry is None:
        entry = AudioCacheEntry(
            video_id=video_id,
            file_path=str(path),
            file_size_bytes=size,
            mime_type=mime,
            cached_at=now,
            last_accessed_at=now,
            cached_by_user_id=cached_by_user_id,
            title=title.strip() if title else None,
            artist=artist.strip() if artist else None,
        )
        db.add(entry)
    else:
        entry.file_path = str(path)
        entry.file_size_bytes = size
        entry.mime_type = mime
        entry.last_accessed_at = now
        if entry.cached_by_user_id is None:
            entry.cached_by_user_id = cached_by_user_id
        _apply_track_metadata(entry, title=title, artist=artist)
    await db.commit()
    await db.refresh(entry)
    return entry


async def get_cache_stats(db: AsyncSession) -> dict:
    entry_count = await db.scalar(select(func.count()).select_from(AudioCacheEntry)) or 0
    total_size = await db.scalar(select(func.coalesce(func.sum(AudioCacheEntry.file_size_bytes), 0))) or 0
    oldest = await db.scalar(select(func.min(AudioCacheEntry.last_accessed_at)))
    newest = await db.scalar(select(func.max(AudioCacheEntry.last_accessed_at)))
    unique_users = await db.scalar(select(func.count(func.distinct(AudioCacheAccess.user_id)))) or 0
    return {
        "entry_count": entry_count,
        "total_size_bytes": total_size,
        "oldest_accessed_at": oldest,
        "newest_accessed_at": newest,
        "unique_users": unique_users,
    }


async def list_cache_entries(
    db: AsyncSession,
    *,
    offset: int = 0,
    limit: int = 50,
    user_id: int | None = None,
) -> list[AudioCacheEntry]:
    query = (
        select(AudioCacheEntry)
        .options(
            selectinload(AudioCacheEntry.access_records).selectinload(AudioCacheAccess.user),
            selectinload(AudioCacheEntry.cached_by_user),
        )
        .order_by(AudioCacheEntry.last_accessed_at.desc())
        .offset(offset)
        .limit(limit)
    )
    if user_id is not None:
        query = query.join(AudioCacheAccess).where(AudioCacheAccess.user_id == user_id)
    result = await db.execute(query)
    return list(result.scalars().unique().all())


async def list_cache_entries_with_titles(
    db: AsyncSession,
    *,
    offset: int = 0,
    limit: int = 50,
    user_id: int | None = None,
) -> list[AudioCacheEntry]:
    await backfill_missing_titles(db)
    return await list_cache_entries(db, offset=offset, limit=limit, user_id=user_id)


def entry_to_read(entry: AudioCacheEntry) -> dict:
    users = [
        {
            "user_id": access.user_id,
            "username": access.user.username if access.user else "",
            "display_name": access.user.display_name if access.user else "",
            "first_accessed_at": access.first_accessed_at,
            "last_accessed_at": access.last_accessed_at,
        }
        for access in entry.access_records
    ]
    return {
        "video_id": entry.video_id,
        "title": entry.title,
        "artist": entry.artist,
        "file_size_bytes": entry.file_size_bytes,
        "mime_type": entry.mime_type,
        "cached_at": entry.cached_at,
        "last_accessed_at": entry.last_accessed_at,
        "cached_by_user_id": entry.cached_by_user_id,
        "cached_by_username": entry.cached_by_user.username if entry.cached_by_user else None,
        "access_count": len(entry.access_records),
        "users": users,
    }


async def _delete_entry_files(entry: AudioCacheEntry) -> int:
    freed = 0
    path = Path(entry.file_path)
    if path.exists():
        freed = path.stat().st_size
        path.unlink(missing_ok=True)
    return freed


async def purge_video(db: AsyncSession, video_id: str) -> tuple[int, int]:
    entry = await db.scalar(select(AudioCacheEntry).where(AudioCacheEntry.video_id == video_id))
    if entry is None:
        return 0, 0
    freed = await _delete_entry_files(entry)
    await db.delete(entry)
    await db.commit()
    return 1, freed


async def purge_videos(db: AsyncSession, video_ids: list[str]) -> tuple[int, int]:
    deleted = 0
    freed = 0
    seen: set[str] = set()
    for video_id in video_ids:
        if video_id in seen:
            continue
        seen.add(video_id)
        d, f = await purge_video(db, video_id)
        deleted += d
        freed += f
    return deleted, freed


async def purge_all(db: AsyncSession) -> tuple[int, int]:
    entries = (await db.execute(select(AudioCacheEntry))).scalars().all()
    freed = 0
    for entry in entries:
        freed += await _delete_entry_files(entry)
    await db.execute(delete(AudioCacheAccess))
    await db.execute(delete(AudioCacheEntry))
    await db.commit()
    return len(entries), freed


async def purge_older_than(db: AsyncSession, days: int) -> tuple[int, int]:
    cutoff = datetime.now(UTC) - timedelta(days=days)
    entries = (
        await db.execute(select(AudioCacheEntry).where(AudioCacheEntry.last_accessed_at < cutoff))
    ).scalars().all()
    freed = 0
    for entry in entries:
        freed += await _delete_entry_files(entry)
        await db.delete(entry)
    await db.commit()
    return len(entries), freed


async def purge_user(db: AsyncSession, user_id: int) -> tuple[int, int]:
    access_rows = (
        await db.execute(select(AudioCacheAccess).where(AudioCacheAccess.user_id == user_id))
    ).scalars().all()
    if not access_rows:
        return 0, 0

    video_ids = {row.video_id for row in access_rows}
    await db.execute(delete(AudioCacheAccess).where(AudioCacheAccess.user_id == user_id))

    deleted = 0
    freed = 0
    for video_id in video_ids:
        remaining = await db.scalar(
            select(func.count()).select_from(AudioCacheAccess).where(AudioCacheAccess.video_id == video_id)
        )
        if remaining and remaining > 0:
            continue
        entry = await db.scalar(select(AudioCacheEntry).where(AudioCacheEntry.video_id == video_id))
        if entry is None:
            continue
        freed += await _delete_entry_files(entry)
        await db.delete(entry)
        deleted += 1
    await db.commit()
    return deleted, freed


async def run_retention_cleanup(db: AsyncSession) -> tuple[int, int]:
    settings = await get_system_settings(db)
    deleted = 0
    freed = 0

    if settings.cache_retention_days is not None and settings.cache_retention_days > 0:
        d, f = await purge_older_than(db, settings.cache_retention_days)
        deleted += d
        freed += f

    if settings.cache_max_size_mb is not None:
        max_bytes = settings.cache_max_size_mb * 1024 * 1024
        total = await db.scalar(select(func.coalesce(func.sum(AudioCacheEntry.file_size_bytes), 0))) or 0
        if total > max_bytes:
            entries = (
                await db.execute(
                    select(AudioCacheEntry).order_by(AudioCacheEntry.last_accessed_at.asc())
                )
            ).scalars().all()
            for entry in entries:
                if total <= max_bytes:
                    break
                total -= entry.file_size_bytes
                freed += await _delete_entry_files(entry)
                await db.delete(entry)
                deleted += 1
            await db.commit()

    return deleted, freed
