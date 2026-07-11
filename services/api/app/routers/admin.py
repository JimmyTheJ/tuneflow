from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin
from app.database import get_db
from app.models import User
from app.schemas import (
    CacheEntryRead,
    CachePurgeResult,
    CacheSettingsRead,
    CacheSettingsUpdate,
    CacheStats,
)
from app.services.cache_manager import (
    backfill_orphaned_files,
    entry_to_read,
    get_cache_stats,
    get_system_settings,
    list_cache_entries,
    purge_all,
    purge_older_than,
    purge_user,
    purge_video,
    run_retention_cleanup,
)

router = APIRouter(prefix="/admin/cache", tags=["admin"])


@router.get("/stats", response_model=CacheStats)
async def cache_stats(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> CacheStats:
    return CacheStats(**await get_cache_stats(db))


@router.get("/settings", response_model=CacheSettingsRead)
async def get_cache_settings(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> CacheSettingsRead:
    settings = await get_system_settings(db)
    return CacheSettingsRead.model_validate(settings, from_attributes=True)


@router.put("/settings", response_model=CacheSettingsRead)
async def update_cache_settings(
    payload: CacheSettingsUpdate,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> CacheSettingsRead:
    settings = await get_system_settings(db)
    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(settings, key, value)
    await db.commit()
    await db.refresh(settings)
    return CacheSettingsRead.model_validate(settings, from_attributes=True)


@router.get("/entries", response_model=list[CacheEntryRead])
async def cache_entries(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    user_id: int | None = Query(default=None),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[CacheEntryRead]:
    entries = await list_cache_entries(db, offset=offset, limit=limit, user_id=user_id)
    return [CacheEntryRead(**entry_to_read(entry)) for entry in entries]


@router.post("/backfill", response_model=CachePurgeResult)
async def backfill_cache(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> CachePurgeResult:
    created = await backfill_orphaned_files(db)
    return CachePurgeResult(deleted_entries=created, freed_bytes=0)


@router.post("/cleanup", response_model=CachePurgeResult)
async def run_cleanup(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> CachePurgeResult:
    deleted, freed = await run_retention_cleanup(db)
    return CachePurgeResult(deleted_entries=deleted, freed_bytes=freed)


@router.delete("", response_model=CachePurgeResult)
async def clear_cache(
    older_than_days: int | None = Query(default=None, ge=1),
    user_id: int | None = Query(default=None),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> CachePurgeResult:
    if older_than_days is not None and user_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Specify either older_than_days or user_id, not both",
        )
    if older_than_days is not None:
        deleted, freed = await purge_older_than(db, older_than_days)
    elif user_id is not None:
        deleted, freed = await purge_user(db, user_id)
    else:
        deleted, freed = await purge_all(db)
    return CachePurgeResult(deleted_entries=deleted, freed_bytes=freed)


@router.delete("/{video_id}", response_model=CachePurgeResult)
async def clear_cache_entry(
    video_id: str,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> CachePurgeResult:
    deleted, freed = await purge_video(db, video_id)
    if deleted == 0:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cache entry not found")
    return CachePurgeResult(deleted_entries=deleted, freed_bytes=freed)
