import json
import re
from datetime import UTC, datetime

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import ParentalSettings, PlayHistory, User, UserRole
from app.schemas import ParentalSettingsRead
from app.security import decode_access_token

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
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    except JWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=ACCOUNT_REMOVED_MESSAGE)
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=ACCOUNT_DISABLED_MESSAGE)
    return user


async def require_parent(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.parent:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Parent access required")
    return current_user


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user


async def require_parent_or_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != UserRole.parent and not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Parent or admin access required")
    return current_user


async def get_child_settings(db: AsyncSession, user: User) -> ParentalSettings | None:
    if user.role != UserRole.child:
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
