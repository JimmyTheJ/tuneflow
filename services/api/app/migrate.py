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
                        cache_refresh_days INTEGER NOT NULL DEFAULT 180,
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
                    INSERT INTO system_settings (id, cache_enabled, cache_retention_days, cache_refresh_days, cache_max_size_mb, cache_cleanup_interval_hours)
                    VALUES (1, 1, NULL, 180, NULL, 24)
                    """
                )
            )

        settings_columns = await conn.execute(text("PRAGMA table_info(system_settings)"))
        settings_cols = {row[1] for row in settings_columns.fetchall()}
        if settings_cols and "cache_refresh_days" not in settings_cols:
            await conn.execute(
                text("ALTER TABLE system_settings ADD COLUMN cache_refresh_days INTEGER NOT NULL DEFAULT 180")
            )
        if settings_cols and "catalog_cache_retention_days" not in settings_cols:
            await conn.execute(
                text("ALTER TABLE system_settings ADD COLUMN catalog_cache_retention_days INTEGER DEFAULT 7")
            )
        if settings_cols and "catalog_cache_max_size_mb" not in settings_cols:
            await conn.execute(
                text("ALTER TABLE system_settings ADD COLUMN catalog_cache_max_size_mb INTEGER")
            )

        cache_entry_columns = await conn.execute(text("PRAGMA table_info(audio_cache_entries)"))
        cache_entry_cols = {row[1] for row in cache_entry_columns.fetchall()}
        if cache_entry_cols:
            if "title" not in cache_entry_cols:
                await conn.execute(text("ALTER TABLE audio_cache_entries ADD COLUMN title VARCHAR(500)"))
            if "artist" not in cache_entry_cols:
                await conn.execute(text("ALTER TABLE audio_cache_entries ADD COLUMN artist VARCHAR(300)"))
            if "last_verified_at" not in cache_entry_cols:
                await conn.execute(text("ALTER TABLE audio_cache_entries ADD COLUMN last_verified_at DATETIME"))
            if "thumbnail_url" not in cache_entry_cols:
                await conn.execute(text("ALTER TABLE audio_cache_entries ADD COLUMN thumbnail_url VARCHAR(500)"))
            if "duration_sec" not in cache_entry_cols:
                await conn.execute(text("ALTER TABLE audio_cache_entries ADD COLUMN duration_sec INTEGER"))
            if "has_video" not in cache_entry_cols:
                await conn.execute(
                    text("ALTER TABLE audio_cache_entries ADD COLUMN has_video BOOLEAN NOT NULL DEFAULT 0")
                )
            if "video_mime_type" not in cache_entry_cols:
                await conn.execute(text("ALTER TABLE audio_cache_entries ADD COLUMN video_mime_type VARCHAR(80)"))
            await conn.execute(
                text(
                    "UPDATE audio_cache_entries SET last_verified_at = cached_at "
                    "WHERE last_verified_at IS NULL"
                )
            )

        catalog_cache_result = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='catalog_cache_entries'")
        )
        if catalog_cache_result.fetchone() is None:
            await conn.execute(
                text(
                    """
                    CREATE TABLE catalog_cache_entries (
                        id INTEGER NOT NULL PRIMARY KEY,
                        cache_key VARCHAR(500) NOT NULL,
                        payload_json TEXT NOT NULL,
                        cached_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL
                    )
                    """
                )
            )
            await conn.execute(
                text("CREATE UNIQUE INDEX ix_catalog_cache_entries_cache_key ON catalog_cache_entries (cache_key)")
            )
            await conn.execute(
                text("CREATE INDEX ix_catalog_cache_entries_cached_at ON catalog_cache_entries (cached_at)")
            )

        eq_profiles_result = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='eq_profiles'")
        )
        if eq_profiles_result.fetchone() is None:
            await conn.execute(
                text(
                    """
                    CREATE TABLE eq_profiles (
                        id INTEGER NOT NULL PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        name VARCHAR(120) NOT NULL,
                        bands_json TEXT NOT NULL,
                        preamp_db FLOAT NOT NULL DEFAULT 0,
                        is_default BOOLEAN NOT NULL DEFAULT 0,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
                    )
                    """
                )
            )
            await conn.execute(text("CREATE INDEX ix_eq_profiles_user_id ON eq_profiles (user_id)"))

        eq_track_result = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='eq_track_assignments'")
        )
        if eq_track_result.fetchone() is None:
            await conn.execute(
                text(
                    """
                    CREATE TABLE eq_track_assignments (
                        id INTEGER NOT NULL PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        video_id VARCHAR(20) NOT NULL,
                        eq_profile_id INTEGER NOT NULL,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
                        FOREIGN KEY(eq_profile_id) REFERENCES eq_profiles (id) ON DELETE CASCADE,
                        CONSTRAINT uq_eq_track_user_video UNIQUE (user_id, video_id)
                    )
                    """
                )
            )
            await conn.execute(
                text("CREATE INDEX ix_eq_track_assignments_user_id ON eq_track_assignments (user_id)")
            )
            await conn.execute(
                text("CREATE INDEX ix_eq_track_assignments_video_id ON eq_track_assignments (video_id)")
            )

        eq_playlist_result = await conn.execute(
            text("SELECT name FROM sqlite_master WHERE type='table' AND name='eq_playlist_assignments'")
        )
        if eq_playlist_result.fetchone() is None:
            await conn.execute(
                text(
                    """
                    CREATE TABLE eq_playlist_assignments (
                        id INTEGER NOT NULL PRIMARY KEY,
                        user_id INTEGER NOT NULL,
                        playlist_id INTEGER NOT NULL,
                        eq_profile_id INTEGER NOT NULL,
                        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
                        FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
                        FOREIGN KEY(playlist_id) REFERENCES playlists (id) ON DELETE CASCADE,
                        FOREIGN KEY(eq_profile_id) REFERENCES eq_profiles (id) ON DELETE CASCADE,
                        CONSTRAINT uq_eq_playlist_user_playlist UNIQUE (user_id, playlist_id)
                    )
                    """
                )
            )
            await conn.execute(
                text(
                    "CREATE INDEX ix_eq_playlist_assignments_user_id ON eq_playlist_assignments (user_id)"
                )
            )
            await conn.execute(
                text(
                    "CREATE INDEX ix_eq_playlist_assignments_playlist_id ON eq_playlist_assignments (playlist_id)"
                )
            )
