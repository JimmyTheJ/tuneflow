from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_API_DIR = Path(__file__).resolve().parents[1]
_REPO_ROOT = _API_DIR.parent.parent
_DEFAULT_DATABASE_URL = "sqlite+aiosqlite:///./data/tuneflow.db"


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

    tuneflow_data_dir: Path = Path("data")
    database_url: str = _DEFAULT_DATABASE_URL
    piped_base_url: str = "https://api.piped.private.coffee"
    piped_fallback_urls: str = "https://api.piped.private.coffee,https://pipedapi-libre.kavin.rocks,https://pipedapi.kavin.rocks"
    cors_origins: str = "*"

    jwt_secret: str = "change-me-to-a-long-random-jwt-secret"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7

    # Interactive setup is the default first-run path. Enable bootstrap only for
    # headless installs where env-provided credentials are intentional.
    bootstrap_enabled: bool = False
    bootstrap_username: str = "admin"
    bootstrap_password: str = "changeme"
    bootstrap_display_name: str = "Admin"
    bootstrap_is_root_admin: bool = True

    setup_min_password_length: int = 8

    docs_enabled: bool = True
    security_headers_enabled: bool = True
    trust_proxy_headers: bool = False

    rate_limit_enabled: bool = True
    login_rate_limit_attempts: int = 10
    login_rate_limit_window_sec: int = 900
    setup_rate_limit_attempts: int = 5
    setup_rate_limit_window_sec: int = 3600
    pin_rate_limit_attempts: int = 10
    pin_rate_limit_window_sec: int = 900

    llm_enabled: bool = True
    llm_base_url: str = "http://127.0.0.1:11434/v1"
    llm_api_key: str = ""
    llm_model: str = "llama3.2"
    llm_timeout_sec: int = 120

    scrobbler_lastfm_api_key: str = ""
    scrobbler_lastfm_api_secret: str = ""
    scrobbler_librefm_api_key: str = ""
    scrobbler_librefm_api_secret: str = ""

    @field_validator("tuneflow_data_dir", mode="before")
    @classmethod
    def _coerce_data_dir(cls, value: object) -> Path:
        return Path(value) if not isinstance(value, Path) else value

    def model_post_init(self, __context: object) -> None:
        self.tuneflow_data_dir = self.tuneflow_data_dir.resolve()
        self.tuneflow_data_dir.mkdir(parents=True, exist_ok=True)

        if self.database_url == _DEFAULT_DATABASE_URL:
            db_path = (self.tuneflow_data_dir / "tuneflow.db").as_posix()
            self.database_url = f"sqlite+aiosqlite:///{db_path}"


settings = Settings()
