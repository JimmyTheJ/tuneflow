from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import (
    ACCOUNT_DISABLED_MESSAGE,
    ACCOUNT_REMOVED_MESSAGE,
    build_user_read,
    get_current_user,
    require_set_parent_pin,
)
from app.config import settings
from app.database import get_db
from app.models import User, UserRoleAssignment
from app.permissions import Permission
from app.rate_limit import (
    enforce_attempt_budget,
    enforce_not_locked,
    get_client_ip,
    limiter,
    record_failures,
)
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
from app.services.households import ensure_unique_username_in_household, get_user_in_household, require_household_by_slug
from app.services.roles import ensure_default_role_profiles, ensure_system_household, user_has_permission

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/setup-status", response_model=SetupStatus)
async def setup_status(db: AsyncSession = Depends(get_db)) -> SetupStatus:
    count = await db.scalar(select(func.count()).select_from(User))
    return SetupStatus(needs_setup=not count)


@router.post("/setup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def setup_root_admin(
    payload: SetupRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    count = await db.scalar(select(func.count()).select_from(User))
    if count and count > 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Server already set up")

    client_ip = get_client_ip(request)
    await enforce_attempt_budget(
        f"setup:ip:{client_ip}",
        limit=settings.setup_rate_limit_attempts,
        window_sec=settings.setup_rate_limit_window_sec,
    )

    password = payload.password
    if len(password) < settings.setup_min_password_length:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Password must be at least {settings.setup_min_password_length} characters",
        )

    system_household = await ensure_system_household(db)
    await ensure_default_role_profiles(db, system_household)
    username = await ensure_unique_username_in_household(
        db,
        household_id=system_household.id,
        username=payload.username,
    )

    user = User(
        username=username,
        display_name=payload.display_name.strip(),
        password_hash=hash_password(payload.password),
        household_id=system_household.id,
        is_root_admin=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, user=await build_user_read(db, user))


@router.post("/login", response_model=TokenResponse)
async def login(payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    household_slug = payload.household_slug.strip().lower()
    username = payload.username.strip().lower()
    client_ip = get_client_ip(request)
    rate_keys = [
        f"login:ip:{client_ip}",
        f"login:household:{household_slug}:user:{username}",
    ]
    await enforce_not_locked(
        rate_keys,
        limit=settings.login_rate_limit_attempts,
        window_sec=settings.login_rate_limit_window_sec,
    )

    household = await require_household_by_slug(db, household_slug)
    user = await get_user_in_household(db, household_id=household.id, username=username)
    if user is None or not verify_password(payload.password, user.password_hash):
        await record_failures(
            rate_keys,
            limit=settings.login_rate_limit_attempts,
            window_sec=settings.login_rate_limit_window_sec,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid household, username, or password")

    result = await db.execute(
        select(User)
        .options(
            selectinload(User.role_assignments).selectinload(UserRoleAssignment.role_profile),
            selectinload(User.household),
        )
        .where(User.id == user.id)
    )
    user = result.scalar_one()
    if user.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=ACCOUNT_REMOVED_MESSAGE)
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=ACCOUNT_DISABLED_MESSAGE)

    await limiter.clear(f"login:household:{household_slug}:user:{username}")
    token = create_access_token(user.id)
    return TokenResponse(access_token=token, user=await build_user_read(db, user))


@router.get("/me", response_model=UserRead)
async def me(current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> UserRead:
    return await build_user_read(db, current_user)


@router.get("/parent-pin/status", response_model=ParentPinStatus)
async def parent_pin_status(current_user: User = Depends(require_set_parent_pin)) -> ParentPinStatus:
    return ParentPinStatus(has_pin=current_user.parent_pin_hash is not None)


@router.get("/parent-pin/enforced", response_model=ParentPinEnforced)
async def parent_pin_enforced(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ParentPinEnforced:
    if current_user.is_root_admin:
        return ParentPinEnforced(enforced=False)

    result = await db.execute(
        select(User).where(
            User.household_id == current_user.household_id,
            User.is_active.is_(True),
            User.deleted_at.is_(None),
        )
    )
    enforced = False
    for member in result.scalars().all():
        if member.parent_pin_hash and await user_has_permission(db, member, Permission.SET_PARENT_PIN):
            enforced = True
            break
    return ParentPinEnforced(enforced=enforced)


@router.put("/parent-pin", status_code=status.HTTP_204_NO_CONTENT)
async def set_parent_pin(
    payload: ParentPinSet,
    current_user: User = Depends(require_set_parent_pin),
    db: AsyncSession = Depends(get_db),
) -> None:
    current_user.parent_pin_hash = hash_password(payload.pin)
    await db.commit()


@router.post("/verify-parent-pin", response_model=ParentPinVerifyResponse)
async def verify_parent_pin(
    payload: ParentPinVerify,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ParentPinVerifyResponse:
    if current_user.household_id is None:
        return ParentPinVerifyResponse(valid=False)

    client_ip = get_client_ip(request)
    rate_key = f"pin:ip:{client_ip}"
    await enforce_not_locked(
        [rate_key],
        limit=settings.pin_rate_limit_attempts,
        window_sec=settings.pin_rate_limit_window_sec,
    )

    result = await db.execute(
        select(User).where(
            User.household_id == current_user.household_id,
            User.is_active.is_(True),
            User.deleted_at.is_(None),
        )
    )
    for member in result.scalars().all():
        if member.parent_pin_hash and await user_has_permission(db, member, Permission.SET_PARENT_PIN):
            if verify_password(payload.pin, member.parent_pin_hash):
                return ParentPinVerifyResponse(valid=True)

    await record_failures(
        [rate_key],
        limit=settings.pin_rate_limit_attempts,
        window_sec=settings.pin_rate_limit_window_sec,
    )
    return ParentPinVerifyResponse(valid=False)
