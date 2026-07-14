"""Persistent SQLite cache for MusicBrainz catalog metadata."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import case, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import SessionLocal
from app.models import CatalogCacheEntry

CATALOG_CACHE_TTL_SEC = 7 * 24 * 3600


def _is_fresh(cached_at: datetime) -> bool:
    if cached_at.tzinfo is None:
        cached_at = cached_at.replace(tzinfo=UTC)
    return datetime.now(UTC) - cached_at < timedelta(seconds=CATALOG_CACHE_TTL_SEC)


async def get_catalog_cache(key: str) -> str | None:
    async with SessionLocal() as db:
        entry = await db.scalar(select(CatalogCacheEntry).where(CatalogCacheEntry.cache_key == key))
        if entry is None or not _is_fresh(entry.cached_at):
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


async def purge_expired_catalog_cache() -> int:
    cutoff = datetime.now(UTC) - timedelta(seconds=CATALOG_CACHE_TTL_SEC)
    async with SessionLocal() as db:
        result = await db.execute(delete(CatalogCacheEntry).where(CatalogCacheEntry.cached_at < cutoff))
        await db.commit()
        return result.rowcount or 0


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
                    func.sum(
                        case(
                            (CatalogCacheEntry.cache_key.like("artist_detail:%"), 0),
                            (CatalogCacheEntry.cache_key.like("album_detail:%"), 0),
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
        "api_response_count": int(row.api_response_count or 0),
        "oldest_cached_at": row.oldest_cached_at,
        "newest_cached_at": row.newest_cached_at,
    }


async def purge_all_catalog_cache(db: AsyncSession) -> tuple[int, int]:
    total_size = await db.scalar(
        select(func.coalesce(func.sum(func.length(CatalogCacheEntry.payload_json)), 0))
    ) or 0
    result = await db.execute(delete(CatalogCacheEntry))
    await db.commit()
    return result.rowcount or 0, int(total_size)
