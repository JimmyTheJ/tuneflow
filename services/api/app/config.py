from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_API_DIR = Path(__file__).resolve().parents[1]
_REPO_ROOT = _API_DIR.parent.parent


def _env_files() -> tuple[str, ...]:
    candidates = (_REPO_ROOT / ".env", _API_DIR / ".env", Path(".env"))
    seen: set[Path] = set()
    files: list[str] = []
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved in seen or not resolved.is_file():
            continue
        seen.add(resolved)
        files.append(str(resolved))
    return tuple(files)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_env_files(), extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./data/tuneflow.db"
    piped_base_url: str = "https://api.piped.private.coffee"
    piped_fallback_urls: str = "https://api.piped.private.coffee,https://pipedapi-libre.kavin.rocks,https://pipedapi.kavin.rocks"
    cors_origins: str = "*"

    jwt_secret: str = "change-me-to-a-long-random-jwt-secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7

    bootstrap_username: str = "admin"
    bootstrap_password: str = "changeme"
    bootstrap_display_name: str = "Admin"

    llm_enabled: bool = True
    llm_base_url: str = "http://127.0.0.1:11434/v1"
    llm_api_key: str = ""
    llm_model: str = "llama3.2"
    llm_timeout_sec: int = 120

    scrobbler_lastfm_api_key: str = ""
    scrobbler_lastfm_api_secret: str = ""
    scrobbler_librefm_api_key: str = ""
    scrobbler_librefm_api_secret: str = ""


settings = Settings()
