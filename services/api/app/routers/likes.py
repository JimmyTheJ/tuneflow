from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import verify_token
from app.database import get_db
from app.models import Like
from app.schemas import LikeRead, TrackBase

router = APIRouter(prefix="/likes", tags=["likes"], dependencies=[Depends(verify_token)])


@router.get("", response_model=list[LikeRead])
async def list_likes(db: AsyncSession = Depends(get_db)) -> list[LikeRead]:
    result = await db.execute(select(Like).order_by(Like.liked_at.desc()))
    return [LikeRead.model_validate(row, from_attributes=True) for row in result.scalars().all()]


@router.post("", response_model=LikeRead, status_code=status.HTTP_201_CREATED)
async def like_track(payload: TrackBase, db: AsyncSession = Depends(get_db)) -> LikeRead:
    existing = await db.execute(select(Like).where(Like.video_id == payload.video_id))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Already liked")

    like = Like(
        video_id=payload.video_id,
        title=payload.title,
        artist=payload.artist,
        thumbnail_url=payload.thumbnail_url,
        duration_sec=payload.duration_sec,
    )
    db.add(like)
    await db.commit()
    await db.refresh(like)
    return LikeRead.model_validate(like, from_attributes=True)


@router.delete("/{video_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlike_track(video_id: str, db: AsyncSession = Depends(get_db)) -> None:
    result = await db.execute(select(Like).where(Like.video_id == video_id))
    like = result.scalar_one_or_none()
    if like is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Like not found")
    await db.delete(like)
    await db.commit()
