from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import (
    assert_same_household,
    build_user_read,
    get_current_user,
    require_manage_parental_controls,
    serialize_json_list,
    settings_to_read,
)
from app.database import get_db
from app.models import ParentalSettings, PlayHistory, User, UserRoleAssignment
from app.schemas import ChildProfile, ChildUsageToday, ParentalSettingsRead, ParentalSettingsUpdate, PlayHistoryRead
from app.services.roles import user_subject_to_parental_controls

router = APIRouter(prefix="/parental", tags=["parental"])


async def _household_child_users(db: AsyncSession, household_id: int) -> list[User]:
    result = await db.execute(
        select(User)
        .options(
            selectinload(User.role_assignments).selectinload(UserRoleAssignment.role_profile),
            selectinload(User.parental_settings),
        )
        .where(User.household_id == household_id, User.deleted_at.is_(None))
        .order_by(User.display_name.asc())
    )
    children: list[User] = []
    for user in result.scalars().all():
        if await user_subject_to_parental_controls(db, user):
            children.append(user)
    return children


@router.get("/children", response_model=list[ChildProfile])
async def list_children(
    current_user: User = Depends(require_manage_parental_controls),
    db: AsyncSession = Depends(get_db),
) -> list[ChildProfile]:
    if current_user.is_root_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Use a household account for parental controls")
    if current_user.household_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Household membership required")

    profiles: list[ChildProfile] = []
    for child in await _household_child_users(db, current_user.household_id):
        if child.parental_settings is None:
            continue
        profiles.append(
            ChildProfile(
                user=await build_user_read(db, child),
                settings=settings_to_read(child.parental_settings),
            )
        )
    return profiles


@router.get("/{child_id}/settings", response_model=ParentalSettingsRead)
async def get_child_settings(
    child_id: int,
    current_user: User = Depends(require_manage_parental_controls),
    db: AsyncSession = Depends(get_db),
) -> ParentalSettingsRead:
    settings = await _get_child_settings_row(db, child_id, current_user)
    return settings_to_read(settings)


@router.put("/{child_id}/settings", response_model=ParentalSettingsRead)
async def update_child_settings(
    child_id: int,
    payload: ParentalSettingsUpdate,
    current_user: User = Depends(require_manage_parental_controls),
    db: AsyncSession = Depends(get_db),
) -> ParentalSettingsRead:
    settings = await _get_child_settings_row(db, child_id, current_user)

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
    current_user: User = Depends(require_manage_parental_controls),
    db: AsyncSession = Depends(get_db),
) -> ChildUsageToday:
    settings = await _get_child_settings_row(db, child_id, current_user)
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
    current_user: User = Depends(require_manage_parental_controls),
    db: AsyncSession = Depends(get_db),
) -> list[PlayHistoryRead]:
    await _get_child_user(db, child_id, current_user)
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
    if not await user_subject_to_parental_controls(db, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Child profile required")
    settings = await _get_child_settings_row(db, current_user.id, current_user)
    return settings_to_read(settings)


async def _get_child_user(db: AsyncSession, child_id: int, actor: User) -> User:
    result = await db.execute(select(User).where(User.id == child_id))
    child = result.scalar_one_or_none()
    if child is None or not await user_subject_to_parental_controls(db, child):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Child account not found")
    await assert_same_household(actor, child)
    return child


async def _get_child_settings_row(db: AsyncSession, child_id: int, actor: User) -> ParentalSettings:
    await _get_child_user(db, child_id, actor)
    result = await db.execute(select(ParentalSettings).where(ParentalSettings.child_user_id == child_id))
    settings = result.scalar_one_or_none()
    if settings is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parental settings not found")
    return settings
