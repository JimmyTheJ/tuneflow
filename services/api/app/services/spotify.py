"""Fetch public Spotify playlists via client-credentials when configured."""

from __future__ import annotations

import re
from dataclasses import dataclass

import httpx

from app.config import settings

_SPOTIFY_ID_RE = re.compile(r"^[A-Za-z0-9]{22}$")
_PLAYLIST_URL_RE = re.compile(
    r"(?:https?://open\.spotify\.com/(?:intl-[a-z]{2}/)?playlist/|spotify:playlist:)([A-Za-z0-9]{22})"
)


@dataclass(frozen=True)
class SpotifyPlaylistTrack:
    spotify_id: str
    title: str
    artist: str
    duration_ms: int | None
    position: int


@dataclass(frozen=True)
class SpotifyPlaylist:
    spotify_id: str
    name: str
    description: str | None
    tracks: list[SpotifyPlaylistTrack]


def spotify_configured() -> bool:
    return bool(settings.spotify_client_id.strip() and settings.spotify_client_secret.strip())


def parse_spotify_playlist_id(url_or_id: str) -> str | None:
    raw = url_or_id.strip()
    if _SPOTIFY_ID_RE.match(raw):
        return raw
    match = _PLAYLIST_URL_RE.search(raw)
    return match.group(1) if match else None


class SpotifyNotConfiguredError(RuntimeError):
    pass


class SpotifyPlaylistError(RuntimeError):
    pass


_token_cache: dict[str, object] = {"access_token": None, "expires_at": 0.0}


async def _client_credentials_token() -> str:
    if not spotify_configured():
        raise SpotifyNotConfiguredError("Spotify is not configured on this server")

    import time

    now = time.time()
    cached = _token_cache.get("access_token")
    expires_at = float(_token_cache.get("expires_at") or 0)
    if isinstance(cached, str) and cached and now < expires_at - 60:
        return cached

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            "https://accounts.spotify.com/api/token",
            data={"grant_type": "client_credentials"},
            auth=(settings.spotify_client_id.strip(), settings.spotify_client_secret.strip()),
        )
    if response.status_code >= 400:
        raise SpotifyPlaylistError(f"Spotify auth failed ({response.status_code})")
    payload = response.json()
    token = payload.get("access_token")
    if not token:
        raise SpotifyPlaylistError("Spotify auth returned no access token")
    _token_cache["access_token"] = token
    _token_cache["expires_at"] = now + float(payload.get("expires_in") or 3600)
    return token


async def fetch_playlist(playlist_id: str) -> SpotifyPlaylist:
    token = await _client_credentials_token()
    headers = {"Authorization": f"Bearer {token}"}
    async with httpx.AsyncClient(timeout=45.0, headers=headers) as client:
        meta = await client.get(f"https://api.spotify.com/v1/playlists/{playlist_id}")
        if meta.status_code == 404:
            raise SpotifyPlaylistError("Spotify playlist not found (is it public?)")
        if meta.status_code >= 400:
            raise SpotifyPlaylistError(f"Spotify playlist lookup failed ({meta.status_code})")
        meta_payload = meta.json()

        tracks: list[SpotifyPlaylistTrack] = []
        next_url: str | None = f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks?limit=100"
        position = 0
        while next_url:
            page = await client.get(next_url)
            if page.status_code >= 400:
                raise SpotifyPlaylistError(f"Spotify tracks fetch failed ({page.status_code})")
            page_payload = page.json()
            for item in page_payload.get("items") or []:
                track = item.get("track") or {}
                if not track or track.get("is_local") or not track.get("id"):
                    continue
                artists = track.get("artists") or []
                artist_name = ", ".join(
                    artist.get("name") for artist in artists if artist.get("name")
                ) or "Unknown"
                title = (track.get("name") or "").strip() or "Unknown"
                tracks.append(
                    SpotifyPlaylistTrack(
                        spotify_id=track["id"],
                        title=title,
                        artist=artist_name,
                        duration_ms=track.get("duration_ms"),
                        position=position,
                    )
                )
                position += 1
            next_url = page_payload.get("next")

    return SpotifyPlaylist(
        spotify_id=playlist_id,
        name=(meta_payload.get("name") or "Spotify playlist").strip() or "Spotify playlist",
        description=(meta_payload.get("description") or None),
        tracks=tracks,
    )
