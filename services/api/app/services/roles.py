import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Household, RoleProfile, User, UserRoleAssignment
from app.permissions import DEFAULT_PROFILE_DEFINITIONS, Permission, ROOT_ADMIN_PERMISSIONS


def parse_permissions(raw: str) -> set[str]:
    try:
        value = json.loads(raw)
        if isinstance(value, list):
            return {str(item) for item in value}
    except json.JSONDecodeError:
        pass
    return set()


def serialize_permissions(permissions: set[str]) -> str:
    return json.dumps(sorted(permissions))


async def get_system_household(db: AsyncSession) -> Household | None:
    result = await db.execute(select(Household).where(Household.is_system.is_(True)))
    return result.scalar_one_or_none()


async def ensure_system_household(db: AsyncSession) -> Household:
    household = await get_system_household(db)
    if household is not None:
        return household

    household = Household(name="System", is_system=True)
    db.add(household)
    await db.flush()
    return household


async def ensure_default_role_profiles(db: AsyncSession, system_household: Household) -> dict[str, RoleProfile]:
    result = await db.execute(select(RoleProfile).where(RoleProfile.is_global.is_(True)))
    existing = {profile.slug: profile for profile in result.scalars().all() if profile.slug}
    profiles: dict[str, RoleProfile] = dict(existing)

    for slug, definition in DEFAULT_PROFILE_DEFINITIONS.items():
        if slug in profiles:
            continue
        profile = RoleProfile(
            name=str(definition["name"]),
            slug=slug,
            owner_household_id=system_household.id,
            is_global=True,
            is_public=True,
            permissions=serialize_permissions(set(definition["permissions"])),  # type: ignore[arg-type]
        )
        db.add(profile)
        profiles[slug] = profile

    await db.flush()
    return profiles


async def get_role_profile_by_slug(db: AsyncSession, slug: str) -> RoleProfile | None:
    result = await db.execute(select(RoleProfile).where(RoleProfile.slug == slug, RoleProfile.is_global.is_(True)))
    return result.scalar_one_or_none()


async def assign_role_profile(db: AsyncSession, user: User, profile: RoleProfile) -> None:
    result = await db.execute(
        select(UserRoleAssignment).where(
            UserRoleAssignment.user_id == user.id,
            UserRoleAssignment.role_profile_id == profile.id,
        )
    )
    if result.scalar_one_or_none() is None:
        db.add(UserRoleAssignment(user_id=user.id, role_profile_id=profile.id))


async def load_user_permissions(db: AsyncSession, user: User) -> set[str]:
    if user.is_root_admin:
        return set(ROOT_ADMIN_PERMISSIONS)

    result = await db.execute(
        select(RoleProfile)
        .join(UserRoleAssignment, UserRoleAssignment.role_profile_id == RoleProfile.id)
        .where(UserRoleAssignment.user_id == user.id)
    )
    permissions: set[str] = set()
    for profile in result.scalars().all():
        permissions.update(parse_permissions(profile.permissions))
    return permissions


async def user_has_permission(db: AsyncSession, user: User, permission: Permission | str) -> bool:
    perm = permission.value if isinstance(permission, Permission) else permission
    return perm in await load_user_permissions(db, user)


async def user_subject_to_parental_controls(db: AsyncSession, user: User) -> bool:
    return await user_has_permission(db, user, Permission.SUBJECT_TO_PARENTAL_CONTROLS)


async def get_assignable_role_profiles(db: AsyncSession, household_id: int) -> list[RoleProfile]:
    result = await db.execute(
        select(RoleProfile)
        .options(selectinload(RoleProfile.owner_household))
        .where(
            RoleProfile.is_global.is_(True)
            | (RoleProfile.owner_household_id == household_id)
            | ((RoleProfile.is_public.is_(True)) & (RoleProfile.owner_household_id != household_id))
        )
        .order_by(RoleProfile.is_global.desc(), RoleProfile.name.asc())
    )
    return list(result.scalars().all())


async def validate_assignable_profiles(
    db: AsyncSession, household_id: int, profile_ids: list[int]
) -> list[RoleProfile]:
    if not profile_ids:
        raise ValueError("At least one role profile is required")

    assignable = {profile.id: profile for profile in await get_assignable_role_profiles(db, household_id)}
    profiles: list[RoleProfile] = []
    for profile_id in profile_ids:
        profile = assignable.get(profile_id)
        if profile is None:
            raise ValueError(f"Role profile {profile_id} is not available to this household")
        profiles.append(profile)
    return profiles


async def replace_user_role_profiles(db: AsyncSession, user: User, profile_ids: list[int]) -> list[RoleProfile]:
    if user.household_id is None:
        raise ValueError("User must belong to a household")

    profiles = await validate_assignable_profiles(db, user.household_id, profile_ids)
    await db.execute(
        UserRoleAssignment.__table__.delete().where(UserRoleAssignment.user_id == user.id)  # type: ignore[attr-defined]
    )
    for profile in profiles:
        db.add(UserRoleAssignment(user_id=user.id, role_profile_id=profile.id))
    return profiles


async def load_user_with_roles(db: AsyncSession, user_id: int) -> User | None:
    result = await db.execute(
        select(User)
        .options(
            selectinload(User.role_assignments).selectinload(UserRoleAssignment.role_profile),
            selectinload(User.household),
        )
        .where(User.id == user_id)
    )
    return result.scalar_one_or_none()


async def create_child_settings(db: AsyncSession, child_user_id: int) -> None:
    from app.models import ParentalSettings

    settings_row = ParentalSettings(
        child_user_id=child_user_id,
        blocked_keywords="[]",
        blocked_video_ids="[]",
    )
    db.add(settings_row)
