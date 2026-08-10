"""Extract YouTube playlist entries via yt-dlp."""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass

import yt_dlp

from app.services.piped import parse_artist_title
from app.services.thumbnails import youtube_thumbnail_url

_LIST_RE = re.compile(r"(?:[?&]list=|/playlist\?list=)([a-zA-Z0-9_-]+)")
_YT_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{6,20}$")


@dataclass(frozen=True)
class YoutubePlaylistEntry:
    video_id: str
    title: str
    artist: str | None
    thumbnail_url: str | None
    duration_sec: int | None
    position: int


@dataclass(frozen=True)
class YoutubePlaylist:
    playlist_id: str
    name: str
    entries: list[YoutubePlaylistEntry]


def parse_youtube_playlist_id(url_or_id: str) -> str | None:
    raw = url_or_id.strip()
    if raw.startswith("PL") and len(raw) >= 13 and re.match(r"^[a-zA-Z0-9_-]+$", raw):
        return raw
    match = _LIST_RE.search(raw)
    return match.group(1) if match else None


class YoutubePlaylistError(RuntimeError):
    pass


def _extract_sync(playlist_id: str) -> YoutubePlaylist:
    url = f"https://www.youtube.com/playlist?list={playlist_id}"
    opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=False)
    if not info:
        raise YoutubePlaylistError("Could not load YouTube playlist")

    entries_raw = info.get("entries") or []
    entries: list[YoutubePlaylistEntry] = []
    for index, entry in enumerate(entries_raw):
        if not entry:
            continue
        video_id = entry.get("id")
        if not video_id or not _YT_ID_RE.match(str(video_id)):
            continue
        raw_title = (entry.get("title") or "").strip() or "Unknown"
        parsed_artist, parsed_title = parse_artist_title(raw_title)
        uploader = entry.get("uploader") or entry.get("channel") or parsed_artist
        duration = entry.get("duration")
        duration_sec = int(duration) if isinstance(duration, (int, float)) else None
        entries.append(
            YoutubePlaylistEntry(
                video_id=str(video_id),
                title=parsed_title or raw_title,
                artist=uploader,
                thumbnail_url=youtube_thumbnail_url(str(video_id)),
                duration_sec=duration_sec,
                position=index,
            )
        )

    name = (info.get("title") or "YouTube playlist").strip() or "YouTube playlist"
    return YoutubePlaylist(playlist_id=playlist_id, name=name, entries=entries)


async def fetch_playlist(playlist_id: str) -> YoutubePlaylist:
    try:
        return await asyncio.to_thread(_extract_sync, playlist_id)
    except YoutubePlaylistError:
        raise
    except Exception as exc:  # noqa: BLE001 — surface yt-dlp failures as domain errors
        raise YoutubePlaylistError(str(exc) or "YouTube playlist extract failed") from exc
