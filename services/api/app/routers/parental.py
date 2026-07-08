from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import (
    get_current_user,
    require_parent,
    serialize_json_list,
    settings_to_read,
)
from app.database import get_db
from app.models import ParentalSettings, PlayHistory, User, UserRole
from app.schemas import ChildProfile, ChildUsageToday, ParentalSettingsRead, ParentalSettingsUpdate, PlayHistoryRead, UserRead

router = APIRouter(prefix="/parental", tags=["parental"])


@router.get("/children", response_model=list[ChildProfile])
async def list_children(
    _: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
) -> list[ChildProfile]:
    result = await db.execute(
        select(User)
        .options(selectinload(User.parental_settings))
        .where(User.role == UserRole.child)
        .order_by(User.display_name.asc())
    )
    profiles: list[ChildProfile] = []
    for child in result.scalars().all():
        if child.parental_settings is None:
            continue
        profiles.append(
            ChildProfile(
                user=UserRead.model_validate(child, from_attributes=True),
                settings=settings_to_read(child.parental_settings),
            )
        )
    return profiles


@router.get("/{child_id}/settings", response_model=ParentalSettingsRead)
async def get_child_settings(
    child_id: int,
    _: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
) -> ParentalSettingsRead:
    settings = await _get_child_settings_row(db, child_id)
    return settings_to_read(settings)


@router.put("/{child_id}/settings", response_model=ParentalSettingsRead)
async def update_child_settings(
    child_id: int,
    payload: ParentalSettingsUpdate,
    _: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
) -> ParentalSettingsRead:
    settings = await _get_child_settings_row(db, child_id)

    updates = payload.model_dump(exclude_unset=True)
    if "blocked_keywords" in updates:
        settings.blocked_keywords = serialize_json_list(updates.pop("blocked_keywords"))
    if "blocked_video_ids" in updates:
        settings.blocked_video_ids = serialize_json_list(updates.pop("blocked_video_ids"))
    for field, value in updates.items():
        setattr(settings, field, value)

    await db.commit()
    await db.refresh(settings)
    return settings_to_read(settings)


@router.get("/{child_id}/usage", response_model=ChildUsageToday)
async def get_child_usage_today(
    child_id: int,
    _: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
) -> ChildUsageToday:
    settings = await _get_child_settings_row(db, child_id)
    start_of_day = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    listened_sec = await db.scalar(
        select(func.coalesce(func.sum(PlayHistory.listened_sec), 0)).where(
            PlayHistory.user_id == child_id,
            PlayHistory.played_at >= start_of_day,
        )
    )
    listened_minutes = int((listened_sec or 0) // 60)
    remaining = None
    if settings.max_daily_minutes is not None:
        remaining = max(settings.max_daily_minutes - listened_minutes, 0)
    return ChildUsageToday(
        child_user_id=child_id,
        listened_minutes_today=listened_minutes,
        max_daily_minutes=settings.max_daily_minutes,
        remaining_minutes=remaining,
    )


@router.get("/{child_id}/history", response_model=list[PlayHistoryRead])
async def get_child_history(
    child_id: int,
    limit: int = Query(default=50, ge=1, le=200),
    _: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
) -> list[PlayHistoryRead]:
    await _get_child_user(db, child_id)
    result = await db.execute(
        select(PlayHistory)
        .where(PlayHistory.user_id == child_id)
        .order_by(PlayHistory.played_at.desc())
        .limit(limit)
    )
    return [PlayHistoryRead.model_validate(row, from_attributes=True) for row in result.scalars().all()]


@router.get("/me/settings", response_model=ParentalSettingsRead)
async def get_my_child_settings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ParentalSettingsRead:
    if current_user.role != UserRole.child:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Child account required")
    settings = await _get_child_settings_row(db, current_user.id)
    return settings_to_read(settings)


async def _get_child_user(db: AsyncSession, child_id: int) -> User:
    result = await db.execute(select(User).where(User.id == child_id, User.role == UserRole.child))
    child = result.scalar_one_or_none()
    if child is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Child account not found")
    return child


async def _get_child_settings_row(db: AsyncSession, child_id: int) -> ParentalSettings:
    await _get_child_user(db, child_id)
    result = await db.execute(select(ParentalSettings).where(ParentalSettings.child_user_id == child_id))
    settings = result.scalar_one_or_none()
    if settings is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parental settings not found")
    return settings
