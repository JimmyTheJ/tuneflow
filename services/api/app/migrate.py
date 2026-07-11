from sqlalchemy import text

from app.config import settings
from app.database import engine


async def run_migrations() -> None:
    async with engine.begin() as conn:
        result = await conn.execute(text("PRAGMA table_info(users)"))
        columns = {row[1] for row in result.fetchall()}
        if "parent_pin_hash" not in columns:
            await conn.execute(text("ALTER TABLE users ADD COLUMN parent_pin_hash VARCHAR(255)"))

        table_result = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='scrobbler_connections'")
        )
        if table_result.fetchone() is None:
            await conn.execute(
                text(
                    """
                    CREATE TABLE scrobbler_connections (
                        id INTEGER NOT NULL PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        provider VARCHAR(7) NOT NULL,
                        username VARCHAR(120) NOT NULL,
                        session_key VARCHAR(255) NOT NULL,
                        scrobbling_enabled BOOLEAN NOT NULL DEFAULT 1,
                        linked_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        CONSTRAINT uq_user_scrobbler_provider UNIQUE (user_id, provider),
                        FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
                    )
                    """
                )
            )
            await conn.execute(
                text("CREATE INDEX ix_scrobbler_connections_user_id ON scrobbler_connections (user_id)")
            )

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

        cache_entries_result = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='audio_cache_entries'")
        )
        if cache_entries_result.fetchone() is None:
            await conn.execute(
                text(
                    """
                    CREATE TABLE audio_cache_entries (
                        id INTEGER NOT NULL PRIMARY KEY,
                        video_id VARCHAR(20) NOT NULL,
                        file_path VARCHAR(500) NOT NULL,
                        file_size_bytes INTEGER NOT NULL DEFAULT 0,
                        mime_type VARCHAR(80) NOT NULL DEFAULT 'application/octet-stream',
                        cached_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        cached_by_user_id INTEGER,
                        CONSTRAINT uq_audio_cache_video UNIQUE (video_id),
                        FOREIGN KEY(cached_by_user_id) REFERENCES users (id) ON DELETE SET NULL
                    )
                    """
                )
            )
            await conn.execute(
                text("CREATE INDEX ix_audio_cache_entries_video_id ON audio_cache_entries (video_id)")
            )
            await conn.execute(
                text(
                    "CREATE INDEX ix_audio_cache_entries_last_accessed_at ON audio_cache_entries (last_accessed_at)"
                )
            )

        cache_access_result = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='audio_cache_access'")
        )
        if cache_access_result.fetchone() is None:
            await conn.execute(
                text(
                    """
                    CREATE TABLE audio_cache_access (
                        id INTEGER NOT NULL PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        video_id VARCHAR(20) NOT NULL,
                        cache_entry_id INTEGER NOT NULL,
                        first_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        last_accessed_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        CONSTRAINT uq_cache_access_user_video UNIQUE (user_id, video_id),
                        FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
                        FOREIGN KEY(cache_entry_id) REFERENCES audio_cache_entries (id) ON DELETE CASCADE
                    )
                    """
                )
            )
            await conn.execute(text("CREATE INDEX ix_audio_cache_access_user_id ON audio_cache_access (user_id)"))
            await conn.execute(text("CREATE INDEX ix_audio_cache_access_video_id ON audio_cache_access (video_id)"))
            await conn.execute(
                text("CREATE INDEX ix_audio_cache_access_cache_entry_id ON audio_cache_access (cache_entry_id)")
            )

        admin_result = await conn.execute(
            text("SELECT id FROM users WHERE role = 'admin' LIMIT 1")
        )
        if admin_result.fetchone() is None:
            await conn.execute(
                text(
                    "UPDATE users SET role = 'admin' WHERE username = :username AND role = 'parent'"
                ),
                {"username": settings.bootstrap_username.strip().lower()},
            )
