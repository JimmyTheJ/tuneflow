import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import SessionLocal, init_db
from app.middleware import SecurityHeadersMiddleware
from app.routers import admin, ai, auth, history, households, likes, music, parental, playlists, role_profiles, scrobbler, users


async def _cache_cleanup_worker() -> None:
    from app.services.cache_manager import backfill_orphaned_files, get_system_settings, run_retention_cleanup

    while True:
        interval_hours = 24
        try:
            async with SessionLocal() as db:
                await backfill_orphaned_files(db)
                await run_retention_cleanup(db)
                system_settings = await get_system_settings(db)
                interval_hours = system_settings.cache_cleanup_interval_hours
        except Exception:
            pass
        await asyncio.sleep(interval_hours * 3600)


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    async with SessionLocal() as db:
        from app.services.cache_manager import backfill_missing_titles, backfill_orphaned_files

        await backfill_orphaned_files(db)
        await backfill_missing_titles(db)
    task = asyncio.create_task(_cache_cleanup_worker())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


app = FastAPI(
    title="Tuneflow API",
    version="0.2.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.docs_enabled else None,
    redoc_url="/redoc" if settings.docs_enabled else None,
    openapi_url="/openapi.json" if settings.docs_enabled else None,
)

app.add_middleware(SecurityHeadersMiddleware)

origins = [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if origins != ["*"] else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(admin.router, prefix="/api")
app.include_router(households.router, prefix="/api")
app.include_router(role_profiles.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(parental.router, prefix="/api")
app.include_router(ai.router, prefix="/api")
app.include_router(music.router, prefix="/api")
app.include_router(playlists.router, prefix="/api")
app.include_router(history.router, prefix="/api")
app.include_router(likes.router, prefix="/api")
app.include_router(scrobbler.router, prefix="/api")


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "tuneflow-api", "version": "0.3.0"}
