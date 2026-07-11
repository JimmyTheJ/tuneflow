from sqlalchemy import text

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
