from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    tuneflow_api_token: str = "dev-token-change-me"
    database_url: str = "sqlite+aiosqlite:///./data/tuneflow.db"
    piped_base_url: str = "https://pipedapi.kavin.rocks"
    cors_origins: str = "*"


settings = Settings()
