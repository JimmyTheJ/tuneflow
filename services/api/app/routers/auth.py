from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ACCOUNT_DISABLED_MESSAGE, ACCOUNT_REMOVED_MESSAGE, get_current_user, require_parent
from app.database import get_db
from app.models import User, UserRole
from app.schemas import (
    LoginRequest,
    ParentPinEnforced,
    ParentPinSet,
    ParentPinStatus,
    ParentPinVerify,
    ParentPinVerifyResponse,
    SetupRequest,
    SetupStatus,
    TokenResponse,
    UserRead,
)
from app.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/setup-status", response_model=SetupStatus)
async def setup_status(db: AsyncSession = Depends(get_db)) -> SetupStatus:
    count = await db.scalar(select(func.count()).select_from(User))
    return SetupStatus(needs_setup=not count)


@router.post("/setup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def setup_first_parent(payload: SetupRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    count = await db.scalar(select(func.count()).select_from(User))
    if count and count > 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Server already set up")

    from app.models import UserRole

    user = User(
        username=payload.username.strip().lower(),
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        role=UserRole.admin,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.username)
    return TokenResponse(access_token=token, user=UserRead.model_validate(user, from_attributes=True))


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    result = await db.execute(select(User).where(User.username == payload.username.strip().lower()))
    user = result.scalar_one_or_none()
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    if user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=ACCOUNT_REMOVED_MESSAGE)
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=ACCOUNT_DISABLED_MESSAGE)

    token = create_access_token(user.username)
    return TokenResponse(access_token=token, user=UserRead.model_validate(user, from_attributes=True))


@router.get("/me", response_model=UserRead)
async def me(current_user: User = Depends(get_current_user)) -> UserRead:
    return UserRead.model_validate(current_user, from_attributes=True)


@router.get("/parent-pin/status", response_model=ParentPinStatus)
async def parent_pin_status(current_user: User = Depends(require_parent)) -> ParentPinStatus:
    return ParentPinStatus(has_pin=current_user.parent_pin_hash is not None)


@router.get("/parent-pin/enforced", response_model=ParentPinEnforced)
async def parent_pin_enforced(db: AsyncSession = Depends(get_db)) -> ParentPinEnforced:
    result = await db.execute(select(User).where(User.role == UserRole.parent, User.is_active.is_(True)))
    enforced = any(parent.parent_pin_hash for parent in result.scalars().all())
    return ParentPinEnforced(enforced=enforced)


@router.put("/parent-pin", status_code=status.HTTP_204_NO_CONTENT)
async def set_parent_pin(
    payload: ParentPinSet,
    current_user: User = Depends(require_parent),
    db: AsyncSession = Depends(get_db),
) -> None:
    current_user.parent_pin_hash = hash_password(payload.pin)
    await db.commit()


@router.post("/verify-parent-pin", response_model=ParentPinVerifyResponse)
async def verify_parent_pin(
    payload: ParentPinVerify,
    _: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ParentPinVerifyResponse:
    result = await db.execute(select(User).where(User.role == UserRole.parent, User.is_active.is_(True)))
    parents = result.scalars().all()
    for parent in parents:
        if parent.parent_pin_hash and verify_password(payload.pin, parent.parent_pin_hash):
            return ParentPinVerifyResponse(valid=True)
    return ParentPinVerifyResponse(valid=False)
