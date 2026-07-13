from sqlalchemy import text

from app.database import engine


async def run_migrations() -> None:
    """Lightweight additive migrations for existing installs. Fresh schemas use create_all."""
    async with engine.begin() as conn:
        settings_result = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='system_settings'")
        )
        if settings_result.fetchone() is None:
            await conn.execute(
                text(
                    """
                    CREATE TABLE system_settings (
                        id INTEGER NOT NULL PRIMARY KEY,
                        cache_enabled BOOLEAN NOT NULL DEFAULT 1,
                        cache_retention_days INTEGER,
                        cache_max_size_mb INTEGER,
                        cache_cleanup_interval_hours INTEGER NOT NULL DEFAULT 24,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
                    )
                    """
                )
            )
            await conn.execute(
                text(
                    """
                    INSERT INTO system_settings (id, cache_enabled, cache_retention_days, cache_max_size_mb, cache_cleanup_interval_hours)
                    VALUES (1, 1, NULL, NULL, 24)
                    """
                )
            )

        cache_entry_columns = await conn.execute(text("PRAGMA table_info(audio_cache_entries)"))
        cache_entry_cols = {row[1] for row in cache_entry_columns.fetchall()}
        if cache_entry_cols:
            if "title" not in cache_entry_cols:
                await conn.execute(text("ALTER TABLE audio_cache_entries ADD COLUMN title VARCHAR(500)"))
            if "artist" not in cache_entry_cols:
                await conn.execute(text("ALTER TABLE audio_cache_entries ADD COLUMN artist VARCHAR(300)"))
