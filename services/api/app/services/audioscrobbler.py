import hashlib
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ScrobblerProviderConfig:
    id: str
    name: str
    api_base_url: str
    auth_base_url: str
    api_key: str
    api_secret: str

    @property
    def configured(self) -> bool:
        return bool(self.api_key and self.api_secret)


def _api_sig(params: dict[str, str], secret: str) -> str:
    payload = "".join(f"{key}{params[key]}" for key in sorted(params))
    return hashlib.md5((payload + secret).encode()).hexdigest()


def _provider_configs() -> dict[str, ScrobblerProviderConfig]:
    return {
        "lastfm": ScrobblerProviderConfig(
            id="lastfm",
            name="Last.fm",
            api_base_url="https://ws.audioscrobbler.com/2.0/",
            auth_base_url="https://www.last.fm/api/auth/",
            api_key=settings.scrobbler_lastfm_api_key,
            api_secret=settings.scrobbler_lastfm_api_secret,
        ),
        "librefm": ScrobblerProviderConfig(
            id="librefm",
            name="Libre.fm",
            api_base_url="https://libre.fm/2.0/",
            auth_base_url="https://libre.fm/api/auth/",
            api_key=settings.scrobbler_librefm_api_key,
            api_secret=settings.scrobbler_librefm_api_secret,
        ),
    }


def get_provider(provider_id: str) -> ScrobblerProviderConfig | None:
    return _provider_configs().get(provider_id)


def list_configured_providers() -> list[ScrobblerProviderConfig]:
    return [provider for provider in _provider_configs().values() if provider.configured]


class AudioscrobblerClient:
    async def _call(
        self,
        provider: ScrobblerProviderConfig,
        method: str,
        params: dict[str, str],
        *,
        session_key: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "method": method,
            "api_key": provider.api_key,
            "format": "json",
            **params,
        }
        if session_key:
            payload["sk"] = session_key
        payload["api_sig"] = _api_sig(payload, provider.api_secret)

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.post(provider.api_base_url, data=payload)
            response.raise_for_status()
            data = response.json()

        if data.get("error"):
            raise RuntimeError(str(data.get("message", "Audioscrobbler API error")))
        return data

    async def get_auth_token(self, provider: ScrobblerProviderConfig) -> str:
        data = await self._call(provider, "auth.getToken", {})
        token = data.get("token")
        if not token:
            raise RuntimeError("Audioscrobbler did not return an auth token")
        return str(token)

    def build_authorize_url(self, provider: ScrobblerProviderConfig, token: str) -> str:
        return f"{provider.auth_base_url}?api_key={provider.api_key}&token={token}"

    async def get_session(self, provider: ScrobblerProviderConfig, token: str) -> tuple[str, str]:
        data = await self._call(provider, "auth.getSession", {"token": token})
        session = data.get("session", {})
        username = str(session.get("name", "")).strip()
        session_key = str(session.get("key", "")).strip()
        if not username or not session_key:
            raise RuntimeError("Audioscrobbler did not return a session")
        return username, session_key

    async def scrobble(
        self,
        provider: ScrobblerProviderConfig,
        *,
        session_key: str,
        artist: str,
        track: str,
        timestamp: datetime | None = None,
        duration_sec: int | None = None,
    ) -> None:
        played_at = timestamp or datetime.now(timezone.utc)
        params = {
            "artist[0]": artist,
            "track[0]": track,
            "timestamp[0]": str(int(played_at.timestamp())),
        }
        if duration_sec is not None:
            params["duration[0]"] = str(duration_sec)
        await self._call(provider, "track.scrobble", params, session_key=session_key)


def normalize_track_metadata(title: str, artist: str | None) -> tuple[str, str]:
    cleaned_title = title.strip() or "Unknown Track"
    cleaned_artist = (artist or "").strip()
    if cleaned_artist:
        return cleaned_artist, cleaned_title

    if " - " in cleaned_title:
        maybe_artist, maybe_track = cleaned_title.split(" - ", 1)
        if maybe_artist.strip() and maybe_track.strip():
            return maybe_artist.strip(), maybe_track.strip()

    return "Unknown Artist", cleaned_title


def should_scrobble(listened_sec: int | None, duration_sec: int | None) -> bool:
    if listened_sec is None:
        return True
    if listened_sec <= 0:
        return False
    if duration_sec is None or duration_sec <= 0:
        return listened_sec >= 30
    half_duration = max(duration_sec // 2, 1)
    threshold = min(half_duration, 4 * 60)
    return listened_sec >= threshold


audioscrobbler_client = AudioscrobblerClient()
