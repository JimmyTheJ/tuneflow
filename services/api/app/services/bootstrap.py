from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import serialize_json_list
from app.config import settings
from app.models import ParentalSettings, User, UserRole
from app.security import hash_password


async def bootstrap_parent_if_needed(db: AsyncSession) -> None:
    count = await db.scalar(select(func.count()).select_from(User))
    if count and count > 0:
        return

    user = User(
        username=settings.bootstrap_username,
        display_name=settings.bootstrap_display_name,
        password_hash=hash_password(settings.bootstrap_password),
        role=UserRole.admin,
    )
    db.add(user)
    await db.commit()


async def create_child_settings(db: AsyncSession, child_user_id: int) -> ParentalSettings:
    settings_row = ParentalSettings(
        child_user_id=child_user_id,
        blocked_keywords=serialize_json_list([]),
        blocked_video_ids=serialize_json_list([]),
    )
    db.add(settings_row)
    await db.commit()
    await db.refresh(settings_row)
    return settings_row
