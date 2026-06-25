from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import verify_token
from app.database import get_db
from app.models import PlayHistory
from app.schemas import PlayHistoryCreate, PlayHistoryRead

router = APIRouter(prefix="/history", tags=["history"], dependencies=[Depends(verify_token)])


@router.get("", response_model=list[PlayHistoryRead])
async def list_history(
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
) -> list[PlayHistoryRead]:
    result = await db.execute(select(PlayHistory).order_by(PlayHistory.played_at.desc()).limit(limit))
    return [PlayHistoryRead.model_validate(row, from_attributes=True) for row in result.scalars().all()]


@router.post("", response_model=PlayHistoryRead, status_code=201)
async def record_play(payload: PlayHistoryCreate, db: AsyncSession = Depends(get_db)) -> PlayHistoryRead:
    entry = PlayHistory(
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
    return PlayHistoryRead.model_validate(entry, from_attributes=True)
