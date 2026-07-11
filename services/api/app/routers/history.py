from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import PlayHistory, User
from app.routers.scrobbler import schedule_scrobble
from app.schemas import PlayHistoryCreate, PlayHistoryRead

router = APIRouter(prefix="/history", tags=["history"])


@router.get("", response_model=list[PlayHistoryRead])
async def list_history(
    limit: int = Query(default=50, ge=1, le=200),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PlayHistoryRead]:
    result = await db.execute(
        select(PlayHistory)
        .where(PlayHistory.user_id == current_user.id)
        .order_by(PlayHistory.played_at.desc())
        .limit(limit)
    )
    return [PlayHistoryRead.model_validate(row, from_attributes=True) for row in result.scalars().all()]


@router.post("", response_model=PlayHistoryRead, status_code=201)
async def record_play(
    payload: PlayHistoryCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PlayHistoryRead:
    entry = PlayHistory(
        user_id=current_user.id,
        video_id=payload.video_id,
        title=payload.title,
        artist=payload.artist,
        thumbnail_url=payload.thumbnail_url,
        duration_sec=payload.duration_sec,
        listened_sec=payload.listened_sec,
    )
    db.add(entry)
    await db.commit()
    await db.refresh(entry)
    schedule_scrobble(
        current_user.id,
        title=entry.title,
        artist=entry.artist,
        duration_sec=entry.duration_sec,
        listened_sec=entry.listened_sec,
    )
    return PlayHistoryRead.model_validate(entry, from_attributes=True)
