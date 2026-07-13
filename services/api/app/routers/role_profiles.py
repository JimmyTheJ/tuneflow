from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.database import get_db
from app.models import Household, RoleProfile, User
from app.permissions import Permission
from app.schemas import RoleProfileCreate, RoleProfileRead, RoleProfileUpdate
from app.services.roles import (
    get_assignable_role_profiles,
    load_user_permissions,
    parse_permissions,
    serialize_permissions,
    user_has_permission,
)

router = APIRouter(prefix="/role-profiles", tags=["role-profiles"])


def _profile_read(profile: RoleProfile) -> RoleProfileRead:
    owner = profile.owner_household
    return RoleProfileRead(
        id=profile.id,
        name=profile.name,
        slug=profile.slug,
        owner_household_id=profile.owner_household_id,
        owner_household_name=owner.name if owner else "Unknown",
        is_global=profile.is_global,
        is_public=profile.is_public,
        is_editable=not profile.is_global,
        permissions=sorted(parse_permissions(profile.permissions)),
        created_at=profile.created_at,
    )


async def _load_profile(db: AsyncSession, profile_id: int) -> RoleProfile:
    result = await db.execute(
        select(RoleProfile)
        .options(selectinload(RoleProfile.owner_household))
        .where(RoleProfile.id == profile_id)
    )
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Role profile not found")
    return profile


def _validate_custom_permissions(permissions: list[str]) -> set[str]:
    allowed = {perm.value for perm in Permission if perm not in {Permission.SYSTEM_ADMIN, Permission.MANAGE_HOUSEHOLDS}}
    selected = set(permissions)
    invalid = selected - allowed
    if invalid:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid permissions: {', '.join(sorted(invalid))}",
        )
    return selected


@router.get("", response_model=list[RoleProfileRead])
async def list_role_profiles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[RoleProfileRead]:
    if current_user.is_root_admin:
        result = await db.execute(
            select(RoleProfile)
            .options(selectinload(RoleProfile.owner_household))
            .order_by(RoleProfile.is_global.desc(), RoleProfile.name.asc())
        )
        return [_profile_read(profile) for profile in result.scalars().all()]

    if current_user.household_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Household membership required")

    profiles = await get_assignable_role_profiles(db, current_user.household_id)
    return [_profile_read(profile) for profile in profiles]


@router.post("", response_model=RoleProfileRead, status_code=status.HTTP_201_CREATED)
async def create_role_profile(
    payload: RoleProfileCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RoleProfileRead:
    if current_user.is_root_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Root admin cannot create household role profiles")
    if current_user.household_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Household membership required")
    if not await user_has_permission(db, current_user, Permission.MANAGE_ROLE_PROFILES):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Role profile management required")

    permissions = _validate_custom_permissions(payload.permissions)
    profile = RoleProfile(
        name=payload.name.strip(),
        owner_household_id=current_user.household_id,
        is_public=payload.is_public,
        permissions=serialize_permissions(permissions),
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile, attribute_names=["owner_household"])
    return _profile_read(profile)


@router.patch("/{profile_id}", response_model=RoleProfileRead)
async def update_role_profile(
    profile_id: int,
    payload: RoleProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RoleProfileRead:
    profile = await _load_profile(db, profile_id)
    if profile.is_global:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Global role profiles cannot be edited")

    if current_user.is_root_admin:
        pass
    elif current_user.household_id != profile.owner_household_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the owner household may edit this profile")
    elif not await user_has_permission(db, current_user, Permission.MANAGE_ROLE_PROFILES):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Role profile management required")

    updates = payload.model_dump(exclude_unset=True)
    if "name" in updates and updates["name"] is not None:
        profile.name = updates["name"].strip()
    if "permissions" in updates and updates["permissions"] is not None:
        profile.permissions = serialize_permissions(_validate_custom_permissions(updates["permissions"]))
    if "is_public" in updates and updates["is_public"] is not None:
        profile.is_public = updates["is_public"]

    await db.commit()
    await db.refresh(profile, attribute_names=["owner_household"])
    return _profile_read(profile)
