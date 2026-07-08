from sqlalchemy import text

from app.database import engine


async def run_migrations() -> None:
    async with engine.begin() as conn:
        result = await conn.execute(text("PRAGMA table_info(users)"))
        columns = {row[1] for row in result.fetchall()}
        if "parent_pin_hash" not in columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN parent_pin_hash VARCHAR(255)"))
