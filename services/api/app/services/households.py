from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Household, User
from app.slugify import normalize_household_slug, validate_household_slug


async def get_household_by_slug(db: AsyncSession, slug: str) -> Household | None:
    normalized = normalize_household_slug(slug)
    result = await db.execute(select(Household).where(Household.slug == normalized))
    return result.scalar_one_or_none()


async def require_household_by_slug(db: AsyncSession, slug: str) -> Household:
    household = await get_household_by_slug(db, slug)
    if household is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Household not found")
    return household


async def ensure_unique_household_slug(db: AsyncSession, slug: str) -> str:
    normalized = validate_household_slug(slug)
    existing = await get_household_by_slug(db, normalized)
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Household slug already exists")
    return normalized


async def get_user_in_household(
    db: AsyncSession,
    *,
    household_id: int,
    username: str,
) -> User | None:
    normalized_username = username.strip().lower()
    result = await db.execute(
        select(User).where(User.household_id == household_id, User.username == normalized_username)
    )
    return result.scalar_one_or_none()


async def ensure_unique_username_in_household(
    db: AsyncSession,
    *,
    household_id: int,
    username: str,
) -> str:
    normalized_username = username.strip().lower()
    existing = await get_user_in_household(db, household_id=household_id, username=normalized_username)
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists in this household")
    return normalized_username
