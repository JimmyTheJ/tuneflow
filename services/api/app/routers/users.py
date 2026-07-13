from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import assert_same_household, build_user_read, require_manage_members, require_root_admin
from app.database import get_db
from app.models import User, UserRoleAssignment
from app.permissions import Permission
from app.schemas import ResetPasswordRequest, UserCreate, UserRead, UserUpdate
from app.security import hash_password
from app.services.roles import (
    create_child_settings,
    parse_permissions,
    replace_user_role_profiles,
    user_has_permission,
    validate_assignable_profiles,
)

router = APIRouter(prefix="/users", tags=["users"])


async def _get_user(db: AsyncSession, user_id: int) -> User:
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _can_modify_user(actor: User, target: User) -> None:
    if target.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if actor.is_root_admin:
        return
    if target.is_root_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify root admin account")


async def _can_manage_target(actor: User, target: User, db: AsyncSession) -> None:
    _can_modify_user(actor, target)
    if actor.is_root_admin:
        return
    await assert_same_household(actor, target)
    if not await user_has_permission(db, actor, Permission.MANAGE_HOUSEHOLD_MEMBERS):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Household member management required")


@router.get("", response_model=list[UserRead])
async def list_users(
    current_user: User = Depends(require_manage_members),
    db: AsyncSession = Depends(get_db),
) -> list[UserRead]:
    query = select(User).where(User.deleted_at.is_(None), User.is_root_admin.is_(False))
    if not current_user.is_root_admin:
        if current_user.household_id is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Household membership required")
        query = query.where(User.household_id == current_user.household_id)

    result = await db.execute(
        query.options(
            selectinload(User.role_assignments).selectinload(UserRoleAssignment.role_profile),
            selectinload(User.household),
        ).order_by(User.created_at.asc())
    )
    return [await build_user_read(db, user) for user in result.scalars().all()]


@router.get("/deleted", response_model=list[UserRead])
async def list_deleted_users(
    _: User = Depends(require_root_admin),
    db: AsyncSession = Depends(get_db),
) -> list[UserRead]:
    result = await db.execute(
        select(User)
        .options(
            selectinload(User.role_assignments).selectinload(UserRoleAssignment.role_profile),
            selectinload(User.household),
        )
        .where(User.deleted_at.isnot(None))
        .order_by(User.deleted_at.desc())
    )
    return [await build_user_read(db, user) for user in result.scalars().all()]


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    current_user: User = Depends(require_manage_members),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    if current_user.is_root_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Create household members from a household administrator account",
        )
    if current_user.household_id is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Household membership required")

    username = payload.username.strip().lower()
    existing = await db.execute(select(User).where(User.username == username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    try:
        profiles = await validate_assignable_profiles(db, current_user.household_id, payload.role_profile_ids)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc

    user = User(
        username=username,
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        household_id=current_user.household_id,
    )
    db.add(user)
    await db.flush()
    await replace_user_role_profiles(db, user, [profile.id for profile in profiles])

    if any(Permission.SUBJECT_TO_PARENTAL_CONTROLS.value in parse_permissions(profile.permissions) for profile in profiles):
        await create_child_settings(db, user.id)

    await db.commit()
    return await build_user_read(db, await _get_user(db, user.id))


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    current_user: User = Depends(require_manage_members),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    user = await _get_user(db, user_id)
    await _can_manage_target(current_user, user, db)

    if payload.is_active is not None:
        if user.id == current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot disable your own account")
        if user.is_root_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot disable root admin account")

    if payload.display_name is not None:
        user.display_name = payload.display_name.strip()
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.role_profile_ids is not None:
        try:
            profiles = await replace_user_role_profiles(db, user, payload.role_profile_ids)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        if any(
            Permission.SUBJECT_TO_PARENTAL_CONTROLS.value in parse_permissions(profile.permissions)
            for profile in profiles
        ):
            if user.parental_settings is None:
                await create_child_settings(db, user.id)

    await db.commit()
    return await build_user_read(db, await _get_user(db, user.id))


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    user_id: int,
    payload: ResetPasswordRequest,
    current_user: User = Depends(require_manage_members),
    db: AsyncSession = Depends(get_db),
) -> None:
    user = await _get_user(db, user_id)
    await _can_manage_target(current_user, user, db)
    user.password_hash = hash_password(payload.password)
    await db.commit()


@router.delete("/{user_id}", response_model=UserRead)
async def soft_delete_user(
    user_id: int,
    current_user: User = Depends(require_root_admin),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    user = await _get_user(db, user_id)
    if user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete your own account")
    if user.is_root_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete root admin account")

    user.deleted_at = datetime.now(UTC)
    user.is_active = False
    await db.commit()
    return await build_user_read(db, await _get_user(db, user.id))


@router.post("/{user_id}/restore", response_model=UserRead)
async def restore_user(
    user_id: int,
    _: User = Depends(require_root_admin),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    user = await _get_user(db, user_id)
    if user.deleted_at is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deleted user not found")

    user.deleted_at = None
    user.is_active = True
    await db.commit()
    return await build_user_read(db, await _get_user(db, user.id))


@router.delete("/{user_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def permanently_delete_user(
    user_id: int,
    current_user: User = Depends(require_root_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    user = await _get_user(db, user_id)
    if user.deleted_at is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User must be soft-deleted before permanent deletion",
        )
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot permanently delete your own account")
    if user.is_root_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot permanently delete root admin account")

    await db.delete(user)
    await db.commit()
