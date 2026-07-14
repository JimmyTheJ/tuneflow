import json
import re
from datetime import UTC, datetime

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models import ParentalSettings, PlayHistory, RoleProfile, User, UserRoleAssignment
from app.permissions import Permission
from app.schemas import ParentalSettingsRead, RoleProfileSummary, UserRead
from app.security import decode_access_token
from app.services.roles import load_user_permissions, user_has_permission, user_subject_to_parental_controls

security = HTTPBearer(auto_error=False)

ACCOUNT_DISABLED_MESSAGE = (
    "Your account has been disabled. Please contact your administrator."
)
ACCOUNT_REMOVED_MESSAGE = "This account has been removed."

EXPLICIT_KEYWORDS = (
    "explicit",
    "uncensored",
    "xxx",
    "porn",
    "nsfw",
    "erotic",
    "fuck",
    "shit",
    "bitch",
    "nude",
)


def parse_json_list(raw: str) -> list[str]:
    try:
        value = json.loads(raw)
        if isinstance(value, list):
            return [str(item) for item in value]
    except json.JSONDecodeError:
        pass
    return []


def serialize_json_list(values: list[str]) -> str:
    return json.dumps(values)


def settings_to_read(settings: ParentalSettings) -> ParentalSettingsRead:
    return ParentalSettingsRead(
        child_user_id=settings.child_user_id,
        block_explicit=settings.block_explicit,
        search_enabled=settings.search_enabled,
        max_daily_minutes=settings.max_daily_minutes,
        allowed_start_hour=settings.allowed_start_hour,
        allowed_end_hour=settings.allowed_end_hour,
        blocked_keywords=parse_json_list(settings.blocked_keywords),
        blocked_video_ids=parse_json_list(settings.blocked_video_ids),
        updated_at=settings.updated_at,
    )


def role_profile_to_summary(profile: RoleProfile) -> RoleProfileSummary:
    return RoleProfileSummary(
        id=profile.id,
        name=profile.name,
        slug=profile.slug,
        is_global=profile.is_global,
    )


async def build_user_read(db: AsyncSession, user: User) -> UserRead:
    result = await db.execute(
        select(User)
        .options(
            selectinload(User.role_assignments).selectinload(UserRoleAssignment.role_profile),
            selectinload(User.household),
        )
        .where(User.id == user.id)
    )
    loaded = result.scalar_one_or_none()
    if loaded is not None:
        user = loaded

    permissions = sorted(await load_user_permissions(db, user))
    profiles = [
        role_profile_to_summary(assignment.role_profile)
        for assignment in user.role_assignments
        if assignment.role_profile is not None
    ]
    profiles.sort(key=lambda profile: (not profile.is_global, profile.name.lower()))

    return UserRead(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        household_id=user.household_id,
        household_name=user.household.name if user.household else None,
        household_slug=user.household.slug if user.household else None,
        is_root_admin=user.is_root_admin,
        is_active=user.is_active,
        role_profiles=profiles,
        permissions=permissions,
        deleted_at=user.deleted_at,
        created_at=user.created_at,
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: AsyncSession = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return await _user_from_token(credentials.credentials, db)


async def get_current_user_from_token(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    token: str | None = Query(default=None, alias="token"),
    db: AsyncSession = Depends(get_db),
) -> User:
    raw = credentials.credentials if credentials else token
    if not raw:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return await _user_from_token(raw, db)


async def _user_from_token(raw_token: str, db: AsyncSession) -> User:
    try:
        payload = decode_access_token(raw_token)
        subject = payload.get("sub")
        if not subject:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        user_id = int(subject)
    except (JWTError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    result = await db.execute(
        select(User)
        .options(
            selectinload(User.role_assignments).selectinload(UserRoleAssignment.role_profile),
            selectinload(User.household),
        )
        .where(User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=ACCOUNT_REMOVED_MESSAGE)
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=ACCOUNT_DISABLED_MESSAGE)
    return user


def require_permission(permission: Permission):
    async def _dependency(
        current_user: User = Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ) -> User:
        if current_user.is_root_admin:
            return current_user
        if not await user_has_permission(db, current_user, permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return current_user

    return _dependency


async def require_root_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_root_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Root admin access required")
    return current_user


async def require_manage_members(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if current_user.is_root_admin:
        return current_user
    if not await user_has_permission(db, current_user, Permission.MANAGE_HOUSEHOLD_MEMBERS):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Household member management required")
    return current_user


async def require_manage_members_or_root(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if current_user.is_root_admin:
        return current_user
    if await user_has_permission(db, current_user, Permission.MANAGE_HOUSEHOLD_MEMBERS):
        return current_user
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")


async def require_manage_parental_controls(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if current_user.is_root_admin:
        return current_user
    if not await user_has_permission(db, current_user, Permission.MANAGE_PARENTAL_CONTROLS):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Parental controls access required")
    return current_user


async def require_manage_role_profiles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if current_user.is_root_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Household settings are managed by household administrators",
        )
    if current_user.household_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Household membership required")
    if not await user_has_permission(db, current_user, Permission.MANAGE_ROLE_PROFILES):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Household administrator access required")
    return current_user


async def require_set_parent_pin(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if current_user.is_root_admin:
        return current_user
    if not await user_has_permission(db, current_user, Permission.SET_PARENT_PIN):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Parent PIN management required")
    return current_user


async def require_playlist_recovery_admin(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> User:
    if current_user.is_root_admin:
        return current_user
    if current_user.household_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Household membership required")
    if not await user_has_permission(db, current_user, Permission.MANAGE_ROLE_PROFILES):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Household administrator access required",
        )
    return current_user


async def get_child_settings(db: AsyncSession, user: User) -> ParentalSettings | None:
    if not await user_subject_to_parental_controls(db, user):
        return None
    result = await db.execute(select(ParentalSettings).where(ParentalSettings.child_user_id == user.id))
    return result.scalar_one_or_none()


def _hour_allowed(now: datetime, start_hour: int, end_hour: int) -> bool:
    hour = now.hour
    if start_hour == end_hour:
        return True
    if start_hour < end_hour:
        return start_hour <= hour < end_hour
    return hour >= start_hour or hour < end_hour


def _contains_blocked_keyword(text: str, keywords: list[str]) -> str | None:
    lowered = text.lower()
    for keyword in keywords:
        if keyword and keyword.lower() in lowered:
            return keyword
    return None


def check_content_allowed(
    *,
    settings: ParentalSettings | None,
    video_id: str | None = None,
    title: str | None = None,
    artist: str | None = None,
    query: str | None = None,
) -> str | None:
    if settings is None:
        return None

    blocked_ids = parse_json_list(settings.blocked_video_ids)
    if video_id and video_id in blocked_ids:
        return "blocked video"

    keywords = parse_json_list(settings.blocked_keywords)
    combined = " ".join(filter(None, [title, artist, query]))
    blocked = _contains_blocked_keyword(combined, keywords)
    if blocked:
        return f"blocked keyword: {blocked}"

    if settings.block_explicit:
        blocked = _contains_blocked_keyword(combined, list(EXPLICIT_KEYWORDS))
        if blocked:
            return "explicit content blocked"

    return None


async def enforce_child_access(db: AsyncSession, user: User) -> ParentalSettings | None:
    settings = await get_child_settings(db, user)
    if settings is None:
        return None

    now = datetime.now(UTC)
    if not _hour_allowed(now, settings.allowed_start_hour, settings.allowed_end_hour):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Listening is not allowed at this time",
        )

    if settings.max_daily_minutes is not None:
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0)
        listened = await db.scalar(
            select(func.coalesce(func.sum(PlayHistory.listened_sec), 0)).where(
                PlayHistory.user_id == user.id,
                PlayHistory.played_at >= start_of_day,
            )
        )
        if (listened or 0) >= settings.max_daily_minutes * 60:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Daily listening limit reached",
            )

    return settings


async def assert_same_household(actor: User, target: User) -> None:
    if actor.is_root_admin:
        return
    if actor.household_id is None or target.household_id is None or actor.household_id != target.household_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cross-household access denied")
