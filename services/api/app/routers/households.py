from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import build_user_read, require_root_admin
from app.database import get_db
from app.models import Household, User, UserRoleAssignment
from app.schemas import HouseholdCreate, HouseholdPublicRead, HouseholdRead, UserRead
from app.security import hash_password
from app.services.households import ensure_unique_household_slug, ensure_unique_username_in_household
from app.services.roles import assign_role_profile, get_role_profile_by_slug
from app.slugify import validate_household_slug

router = APIRouter(prefix="/households", tags=["households"])


async def _household_read(db: AsyncSession, household: Household) -> HouseholdRead:
    member_count = int(
        await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.household_id == household.id, User.deleted_at.is_(None))
        )
        or 0
    )
    return HouseholdRead(
        id=household.id,
        name=household.name,
        slug=household.slug,
        is_system=household.is_system,
        member_count=member_count,
        created_at=household.created_at,
    )


@router.get("/public/{slug}", response_model=HouseholdPublicRead)
async def get_public_household(slug: str, db: AsyncSession = Depends(get_db)) -> HouseholdPublicRead:
    try:
        normalized = validate_household_slug(slug)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Household not found") from exc

    result = await db.execute(select(Household).where(Household.slug == normalized))
    household = result.scalar_one_or_none()
    if household is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Household not found")
    return HouseholdPublicRead(slug=household.slug, name=household.name)


@router.get("", response_model=list[HouseholdRead])
async def list_households(
    _: User = Depends(require_root_admin),
    db: AsyncSession = Depends(get_db),
) -> list[HouseholdRead]:
    result = await db.execute(select(Household).where(Household.is_system.is_(False)).order_by(Household.name.asc()))
    households = result.scalars().all()
    return [await _household_read(db, household) for household in households]


@router.post("", response_model=HouseholdRead, status_code=status.HTTP_201_CREATED)
async def create_household(
    payload: HouseholdCreate,
    _: User = Depends(require_root_admin),
    db: AsyncSession = Depends(get_db),
) -> HouseholdRead:
    slug = await ensure_unique_household_slug(db, payload.slug)

    household = Household(name=payload.name.strip(), slug=slug, is_system=False)
    db.add(household)
    await db.flush()

    username = await ensure_unique_username_in_household(
        db,
        household_id=household.id,
        username=payload.admin_username,
    )

    admin_profile = await get_role_profile_by_slug(db, "household_admin")
    if admin_profile is None:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Default role profiles missing")

    admin_user = User(
        username=username,
        display_name=payload.admin_display_name.strip(),
        password_hash=hash_password(payload.admin_password),
        household_id=household.id,
    )
    db.add(admin_user)
    await db.flush()
    await assign_role_profile(db, admin_user, admin_profile)

    await db.commit()
    await db.refresh(household)
    return await _household_read(db, household)


@router.get("/{household_id}/members", response_model=list[UserRead])
async def list_household_members(
    household_id: int,
    current_user: User = Depends(require_root_admin),
    db: AsyncSession = Depends(get_db),
) -> list[UserRead]:
    household = await db.get(Household, household_id)
    if household is None or household.is_system:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Household not found")

    result = await db.execute(
        select(User)
        .options(
            selectinload(User.role_assignments).selectinload(UserRoleAssignment.role_profile),
            selectinload(User.household),
        )
        .where(User.household_id == household_id, User.deleted_at.is_(None))
        .order_by(User.created_at.asc())
    )
    members = result.scalars().all()
    return [await build_user_read(db, member) for member in members]
