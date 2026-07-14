"""Persistent SQLite cache for MusicBrainz catalog metadata."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select

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
