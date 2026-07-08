from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    pass


engine = create_async_engine(settings.database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session


async def init_db() -> None:
    from app import models  # noqa: F401
    from app.migrate import run_migrations
    from app.services.bootstrap import bootstrap_parent_if_needed

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    await run_migrations()

    async with SessionLocal() as session:
        await bootstrap_parent_if_needed(session)
