"""Persistent SQLite cache for MusicBrainz catalog metadata."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import SessionLocal
from app.models import CatalogCacheEntry

DEFAULT_CATALOG_RETENTION_DAYS = 7


def is_catalog_entry_fresh(cached_at: datetime, retention_days: int | None) -> bool:
    if retention_days is None:
        return True
    if retention_days <= 0:
        return False
    if cached_at.tzinfo is None:
        cached_at = cached_at.replace(tzinfo=UTC)
    return datetime.now(UTC) - cached_at < timedelta(days=retention_days)


async def _purge_catalog_entries(db: AsyncSession, entries: list[CatalogCacheEntry]) -> tuple[int, int]:
    if not entries:
        return 0, 0
    freed = sum(len(entry.payload_json) for entry in entries)
    for entry in entries:
        await db.delete(entry)
    await db.commit()
    return len(entries), freed


def track_resolution_cache_key(
    *,
    artist_name: str,
    track_title: str,
    recording_mbid: str | None = None,
) -> str:
    if recording_mbid:
        return f"track_resolve:v2:recording:{recording_mbid}"
    return f"track_resolve:v2:query:{artist_name.strip().lower()}|{track_title.strip().lower()}"


async def get_catalog_cache_many(keys: list[str]) -> dict[str, str]:
    if not keys:
        return {}
    async with SessionLocal() as db:
        from app.services.cache_manager import get_system_settings

        settings = await get_system_settings(db)
        retention_days = settings.catalog_cache_retention_days
        entries = (
            await db.execute(select(CatalogCacheEntry).where(CatalogCacheEntry.cache_key.in_(keys)))
        ).scalars().all()
        result: dict[str, str] = {}
        for entry in entries:
            if is_catalog_entry_fresh(entry.cached_at, retention_days):
                result[entry.cache_key] = entry.payload_json
        return result


async def get_catalog_cache(key: str, *, retention_days: int | None = None) -> str | None:
    async with SessionLocal() as db:
        from app.services.cache_manager import get_system_settings

        if retention_days is None:
            settings = await get_system_settings(db)
            retention_days = settings.catalog_cache_retention_days

        entry = await db.scalar(select(CatalogCacheEntry).where(CatalogCacheEntry.cache_key == key))
        if entry is None or not is_catalog_entry_fresh(entry.cached_at, retention_days):
            return None
        return entry.payload_json


async def set_catalog_cache(key: str, payload_json: str) -> None:
    async with SessionLocal() as db:
        entry = await db.scalar(select(CatalogCacheEntry).where(CatalogCacheEntry.cache_key == key))
        if entry is None:
            db.add(CatalogCacheEntry(cache_key=key, payload_json=payload_json))
        else:
            entry.payload_json = payload_json
            entry.cached_at = datetime.now(UTC)
        await db.commit()


async def purge_older_than_catalog_cache(db: AsyncSession, days: int) -> tuple[int, int]:
    cutoff = datetime.now(UTC) - timedelta(days=days)
    entries = (
        await db.execute(select(CatalogCacheEntry).where(CatalogCacheEntry.cached_at < cutoff))
    ).scalars().all()
    return await _purge_catalog_entries(db, entries)


async def purge_all_catalog_cache(db: AsyncSession) -> tuple[int, int]:
    entries = (await db.execute(select(CatalogCacheEntry))).scalars().all()
    return await _purge_catalog_entries(db, entries)


async def run_catalog_retention_cleanup(db: AsyncSession) -> tuple[int, int]:
    from app.services.cache_manager import get_system_settings

    settings = await get_system_settings(db)
    deleted = 0
    freed = 0

    if settings.catalog_cache_retention_days is not None and settings.catalog_cache_retention_days > 0:
        d, f = await purge_older_than_catalog_cache(db, settings.catalog_cache_retention_days)
        deleted += d
        freed += f

    if settings.catalog_cache_max_size_mb is not None:
        max_bytes = settings.catalog_cache_max_size_mb * 1024 * 1024
        total = await db.scalar(
            select(func.coalesce(func.sum(func.length(CatalogCacheEntry.payload_json)), 0))
        ) or 0
        if total > max_bytes:
            entries = (
                await db.execute(select(CatalogCacheEntry).order_by(CatalogCacheEntry.cached_at.asc()))
            ).scalars().all()
            for entry in entries:
                if total <= max_bytes:
                    break
                size = len(entry.payload_json)
                total -= size
                freed += size
                await db.delete(entry)
                deleted += 1
            await db.commit()

    return deleted, freed


async def get_catalog_cache_stats(db: AsyncSession) -> dict:
    row = (
        await db.execute(
            select(
                func.count().label("entry_count"),
                func.coalesce(func.sum(func.length(CatalogCacheEntry.payload_json)), 0).label("total_size_bytes"),
                func.coalesce(
                    func.sum(case((CatalogCacheEntry.cache_key.like("artist_detail:%"), 1), else_=0)),
                    0,
                ).label("artist_count"),
                func.coalesce(
                    func.sum(case((CatalogCacheEntry.cache_key.like("album_detail:%"), 1), else_=0)),
                    0,
                ).label("album_count"),
                func.coalesce(
                    func.sum(case((CatalogCacheEntry.cache_key.like("track_resolve:%"), 1), else_=0)),
                    0,
                ).label("track_resolve_count"),
                func.coalesce(
                    func.sum(
                        case(
                            (CatalogCacheEntry.cache_key.like("artist_detail:%"), 0),
                            (CatalogCacheEntry.cache_key.like("album_detail:%"), 0),
                            (CatalogCacheEntry.cache_key.like("track_resolve:%"), 0),
                            else_=1,
                        )
                    ),
                    0,
                ).label("api_response_count"),
                func.min(CatalogCacheEntry.cached_at).label("oldest_cached_at"),
                func.max(CatalogCacheEntry.cached_at).label("newest_cached_at"),
            ).select_from(CatalogCacheEntry)
        )
    ).one()
    return {
        "entry_count": int(row.entry_count or 0),
        "total_size_bytes": int(row.total_size_bytes or 0),
        "artist_count": int(row.artist_count or 0),
        "album_count": int(row.album_count or 0),
        "track_resolve_count": int(row.track_resolve_count or 0),
        "api_response_count": int(row.api_response_count or 0),
        "oldest_cached_at": row.oldest_cached_at,
        "newest_cached_at": row.newest_cached_at,
    }


def clear_catalog_memory_cache() -> None:
    from app.services.musicbrainz import musicbrainz_client

    musicbrainz_client.clear_memory_cache()
