from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin, require_parent, require_parent_or_admin
from app.database import get_db
from app.models import User, UserRole
from app.schemas import ResetPasswordRequest, UserCreate, UserRead, UserUpdate
from app.security import hash_password
from app.services.bootstrap import create_child_settings

router = APIRouter(prefix="/users", tags=["users"])


def _can_modify_user(current_user: User, target: User) -> None:
    if target.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if current_user.role == UserRole.parent and not current_user.is_admin:
        if target.role == UserRole.parent and target.id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify that account")
        if target.is_admin and target.id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify that account")
    elif target.is_admin and target.id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify another admin account")


async def _active_admin_count(db: AsyncSession, exclude_user_id: int | None = None) -> int:
    query = select(func.count()).select_from(User).where(
        User.is_admin.is_(True),
        User.deleted_at.is_(None),
    )
    if exclude_user_id is not None:
        query = query.where(User.id != exclude_user_id)
    return int(await db.scalar(query) or 0)


@router.get("", response_model=list[UserRead])
async def list_users(
    _: User = Depends(require_parent_or_admin),
    db: AsyncSession = Depends(get_db),
) -> list[UserRead]:
    result = await db.execute(
        select(User).where(User.deleted_at.is_(None)).order_by(User.created_at.asc())
    )
    return [UserRead.model_validate(user, from_attributes=True) for user in result.scalars().all()]


@router.get("/deleted", response_model=list[UserRead])
async def list_deleted_users(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[UserRead]:
    result = await db.execute(
        select(User).where(User.deleted_at.isnot(None)).order_by(User.deleted_at.desc())
    )
    return [UserRead.model_validate(user, from_attributes=True) for user in result.scalars().all()]


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    current_user: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    username = payload.username.strip().lower()
    existing = await db.execute(select(User).where(User.username == username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    if payload.role in {UserRole.parent, UserRole.admin}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot create that account type")

    user = User(
        username=username,
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        role=UserRole(payload.role.value),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    if user.role == UserRole.child:
        await create_child_settings(db, user.id)

    return UserRead.model_validate(user, from_attributes=True)


def _can_toggle_active(current_user: User, target: User) -> None:
    _can_modify_user(current_user, target)
    if target.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot disable your own account")
    if target.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot disable an admin account")
    if current_user.role == UserRole.parent and not current_user.is_admin and target.role == UserRole.parent:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot disable that account")


@router.patch("/{user_id}", response_model=UserRead)
async def update_user(
    user_id: int,
    payload: UserUpdate,
    current_user: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    _can_modify_user(current_user, user)
    if payload.is_active is not None:
        _can_toggle_active(current_user, user)

    if payload.display_name is not None:
        user.display_name = payload.display_name.strip()
    if payload.is_active is not None:
        user.is_active = payload.is_active

    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user, from_attributes=True)


@router.post("/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_password(
    user_id: int,
    payload: ResetPasswordRequest,
    current_user: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    _can_modify_user(current_user, user)
    if current_user.role == UserRole.parent and not current_user.is_admin:
        if user.role == UserRole.parent or user.is_admin:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot reset password for that account")
    user.password_hash = hash_password(payload.password)
    await db.commit()


@router.post("/{user_id}/grant-admin", response_model=UserRead)
async def grant_admin(
    user_id: int,
    current_user: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    if await _active_admin_count(db) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An admin account already exists. Use transfer instead.",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.role not in {UserRole.parent, UserRole.adult}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access can only be granted to a parent or adult account",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot grant admin to a disabled account")

    user.is_admin = True
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user, from_attributes=True)


@router.post("/{user_id}/transfer-admin", response_model=UserRead)
async def transfer_admin(
    user_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot transfer admin to yourself. Use relinquish instead.",
        )

    result = await db.execute(select(User).where(User.id == user_id))
    target = result.scalar_one_or_none()
    if target is None or target.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if target.role not in {UserRole.parent, UserRole.adult}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access can only be transferred to a parent or adult account",
        )
    if not target.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot transfer admin to a disabled account")

    current_user.is_admin = False
    target.is_admin = True
    await db.commit()
    await db.refresh(target)
    return UserRead.model_validate(target, from_attributes=True)


@router.post("/relinquish-admin", response_model=UserRead)
async def relinquish_admin(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")

    if await _active_admin_count(db, exclude_user_id=current_user.id) == 0:
        current_user.is_admin = False
        await db.commit()
        await db.refresh(current_user)
        return UserRead.model_validate(current_user, from_attributes=True)

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Another admin account exists. Transfer admin access instead of relinquishing.",
    )


@router.delete("/{user_id}", response_model=UserRead)
async def soft_delete_user(
    user_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot delete your own account")

    user.deleted_at = datetime.now(UTC)
    user.is_active = False
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user, from_attributes=True)


@router.post("/{user_id}/restore", response_model=UserRead)
async def restore_user(
    user_id: int,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or user.deleted_at is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deleted user not found")

    user.deleted_at = None
    user.is_active = True
    await db.commit()
    await db.refresh(user)
    return UserRead.model_validate(user, from_attributes=True)


@router.delete("/{user_id}/permanent", status_code=status.HTTP_204_NO_CONTENT)
async def permanently_delete_user(
    user_id: int,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None or user.deleted_at is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User must be soft-deleted before permanent deletion",
        )
    if user.id == current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot permanently delete your own account")

    if user.is_admin:
        if await _active_admin_count(db, exclude_user_id=user.id) == 0:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Cannot permanently delete the last active admin account",
            )

    await db.delete(user)
    await db.commit()
