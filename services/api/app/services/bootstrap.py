from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import User
from app.security import hash_password
from app.services.roles import assign_role_profile, ensure_default_role_profiles, ensure_system_household


async def bootstrap_root_admin_if_needed(db: AsyncSession) -> None:
    if not settings.bootstrap_enabled:
        return

    count = await db.scalar(select(func.count()).select_from(User))
    if count and count > 0:
        return

    system_household = await ensure_system_household(db)
    await ensure_default_role_profiles(db, system_household)

    user = User(
        username=settings.bootstrap_username,
        display_name=settings.bootstrap_display_name,
        password_hash=hash_password(settings.bootstrap_password),
        household_id=system_household.id,
        is_root_admin=True,
    )
    db.add(user)
    await db.commit()


async def initialize_system_defaults(db: AsyncSession) -> None:
    system_household = await ensure_system_household(db)
    await ensure_default_role_profiles(db, system_household)
    await db.commit()
