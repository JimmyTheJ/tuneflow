from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_parent
from app.database import get_db
from app.models import User, UserRole
from app.schemas import ResetPasswordRequest, UserCreate, UserRead, UserUpdate
from app.security import hash_password
from app.services.bootstrap import create_child_settings

router = APIRouter(prefix="/users", tags=["users"])


@router.get("", response_model=list[UserRead])
async def list_users(
    _: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
) -> list[UserRead]:
    result = await db.execute(select(User).order_by(User.created_at.asc()))
    return [UserRead.model_validate(user, from_attributes=True) for user in result.scalars().all()]


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
async def create_user(
    payload: UserCreate,
    _: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
) -> UserRead:
    username = payload.username.strip().lower()
    existing = await db.execute(select(User).where(User.username == username))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")

    if payload.role == UserRole.parent:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot create another parent account")

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
    if user.role == UserRole.parent and user.id != current_user.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot modify another parent account")

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
    _: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
) -> None:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    user.password_hash = hash_password(payload.password)
    await db.commit()
