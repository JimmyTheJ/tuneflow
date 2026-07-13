from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Household, User
from app.slugify import normalize_household_slug, validate_household_slug

HOUSEHOLD_SLUG_CONSTRAINT = "uq_household_slug"


def is_household_slug_conflict(exc: IntegrityError) -> bool:
    message = str(getattr(exc, "orig", exc)).lower()
    return HOUSEHOLD_SLUG_CONSTRAINT in message or "households.slug" in message


def raise_slug_conflict_from_integrity(exc: IntegrityError) -> None:
    if is_household_slug_conflict(exc):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Household slug already exists",
        ) from exc
    raise exc


async def get_household_by_slug(db: AsyncSession, slug: str) -> Household | None:
    normalized = normalize_household_slug(slug)
    result = await db.execute(select(Household).where(Household.slug == normalized))
    return result.scalar_one_or_none()


async def require_household_by_slug(db: AsyncSession, slug: str) -> Household:
    household = await get_household_by_slug(db, slug)
    if household is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Household not found")
    return household


def validated_household_slug(slug: str) -> str:
    """Format and reserved-name validation only. Uniqueness is enforced by the database."""
    return validate_household_slug(slug)


async def ensure_unique_household_slug(db: AsyncSession, slug: str, *, exclude_household_id: int | None = None) -> str:
    """Fast-path uniqueness check. Concurrent writers are still blocked at commit time."""
    normalized = validated_household_slug(slug)
    existing = await get_household_by_slug(db, normalized)
    if existing is not None and existing.id != exclude_household_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Household slug already exists")
    return normalized


async def update_household_slug(db: AsyncSession, household: Household, slug: str) -> str:
    normalized = validated_household_slug(slug)
    if household.slug == normalized:
        return normalized

    household.slug = normalized
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise_slug_conflict_from_integrity(exc)
    await db.refresh(household)
    return normalized


async def flush_or_raise_slug_conflict(db: AsyncSession) -> None:
    try:
        await db.flush()
    except IntegrityError as exc:
        await db.rollback()
        raise_slug_conflict_from_integrity(exc)


async def get_household_for_user(db: AsyncSession, user: User) -> Household:
    if user.household_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Household membership required")
    household = await db.get(Household, user.household_id)
    if household is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Household not found")
    return household


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
