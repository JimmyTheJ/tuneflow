import asyncio
import re
from pathlib import Path

import yt_dlp

_YT_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{6,20}$")
_AUDIO_FORMAT = "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best"
_AUDIO_SUFFIXES = {".m4a", ".webm", ".opus", ".mp3", ".aac"}


def _cache_dir() -> Path:
    path = Path(__file__).resolve().parents[2] / "data" / "audio_cache"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _guess_mime(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".m4a":
        return "audio/mp4"
    if suffix == ".webm":
        return "audio/webm"
    if suffix == ".opus":
        return "audio/opus"
    if suffix in {".mp3", ".aac"}:
        return "audio/mpeg"
    return "application/octet-stream"


def _find_cached_file(cache_dir: Path, video_id: str) -> Path | None:
    for candidate in cache_dir.glob(f"{video_id}.*"):
        if candidate.suffix.lower() in _AUDIO_SUFFIXES and candidate.stat().st_size > 0:
            return candidate
    return None


def _download_sync(video_id: str, cache_dir: Path) -> Path:
    existing = _find_cached_file(cache_dir, video_id)
    if existing:
        return existing

    url = f"https://www.youtube.com/watch?v={video_id}"
    outtmpl = str(cache_dir / f"{video_id}.%(ext)s")
    with yt_dlp.YoutubeDL(
        {
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "format": _AUDIO_FORMAT,
            "outtmpl": outtmpl,
        }
    ) as ydl:
        ydl.download([url])

    downloaded = _find_cached_file(cache_dir, video_id)
    if downloaded is None:
        raise FileNotFoundError(f"Audio download failed for {video_id}")
    return downloaded


async def get_cached_audio_file(video_id: str) -> tuple[Path, str]:
    if not _YT_ID_RE.match(video_id):
        raise ValueError("Invalid video id")

    cache_dir = _cache_dir()
    path = await asyncio.to_thread(_download_sync, video_id, cache_dir)
    return path, _guess_mime(path)
