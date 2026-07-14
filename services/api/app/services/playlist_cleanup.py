from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Playlist
from app.services.cache_manager import get_system_settings


async def run_playlist_retention_cleanup(db: AsyncSession) -> int:
    settings = await get_system_settings(db)
    if settings.playlist_retention_days <= 0:
        return 0

    cutoff = datetime.now(UTC) - timedelta(days=settings.playlist_retention_days)
    result = await db.execute(
        select(Playlist).where(Playlist.deleted_at.isnot(None), Playlist.deleted_at < cutoff)
    )
    deleted = 0
    for playlist in result.scalars():
        await db.delete(playlist)
        deleted += 1
    if deleted:
        await db.commit()
    return deleted
