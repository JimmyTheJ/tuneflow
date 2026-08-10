import asyncio
import re
import subprocess
import sys
from collections.abc import AsyncIterator
from queue import Queue
from threading import Thread

import yt_dlp

from app.schemas import SearchResult, StreamInfo
from app.services.piped import parse_artist_title
from app.services.thumbnails import youtube_thumbnail_url

_YT_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{6,20}$")
_SENTINEL = object()

_AUDIO_FORMAT = "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best"
_VIDEO_AV_FORMAT = "best[height<=720][ext=mp4]/best[ext=mp4]/best"
_VIDEO_ONLY_FORMAT = "bestvideo[height<=720][ext=mp4]/bestvideo/bestvideo"

_YTDL_BASE_OPTS = {
    "quiet": True,
    "no_warnings": True,
    "noplaylist": True,
}

# Flat search often already includes duration/uploader; enrich only sparse hits.
_ENRICH_CONCURRENCY = 4
_METADATA_OPTS = {
    **_YTDL_BASE_OPTS,
    "skip_download": True,
    "socket_timeout": 12,
    "retries": 1,
}


def _mime_from_info(info: dict, *, default_prefix: str) -> str:
    mime_type = info.get("mime_type")
    if mime_type:
        return mime_type
    ext = info.get("ext") or ("mp4" if default_prefix == "video" else "webm")
    return f"{default_prefix}/{ext}"


def _extract_sync(video_id: str, *, format_selector: str) -> dict:
    if not _YT_ID_RE.match(video_id):
        raise ValueError("Invalid video id")
    url = f"https://www.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL({**_YTDL_BASE_OPTS, "format": format_selector}) as ydl:
        return ydl.extract_info(url, download=False)


def _search_sync(query: str, limit: int) -> list[str]:
    with yt_dlp.YoutubeDL({**_YTDL_BASE_OPTS, "extract_flat": True}) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    entries = info.get("entries") or []
    return [entry["id"] for entry in entries if entry.get("id")]


async def search_video_ids(query: str, limit: int = 8) -> list[str]:
    return await asyncio.to_thread(_search_sync, query, limit)


async def search_video_entries(query: str, limit: int = 10) -> list[dict]:
    return await asyncio.to_thread(_search_sync_entries, query, limit)


def _search_sync_entries(query: str, limit: int) -> list[dict]:
    with yt_dlp.YoutubeDL({**_YTDL_BASE_OPTS, "extract_flat": True}) as ydl:
        info = ydl.extract_info(f"ytsearch{limit}:{query}", download=False)
    entries = info.get("entries") or []
    return [entry for entry in entries if entry.get("id")]


def _entry_needs_enrichment(entry: dict) -> bool:
    has_uploader = bool(entry.get("uploader") or entry.get("channel") or entry.get("uploader_id"))
    return not entry.get("duration") or not has_uploader or not entry.get("channel_id")


def _metadata_sync(video_id: str) -> dict | None:
    if not _YT_ID_RE.match(video_id):
        return None
    url = f"https://www.youtube.com/watch?v={video_id}"
    try:
        with yt_dlp.YoutubeDL(_METADATA_OPTS) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception:
        return None
    return info if isinstance(info, dict) else None


def _merge_entry_metadata(entry: dict, meta: dict) -> dict:
    merged = dict(entry)
    if meta.get("title") and not merged.get("title"):
        merged["title"] = meta["title"]
    if meta.get("duration") and not merged.get("duration"):
        merged["duration"] = meta["duration"]
    if meta.get("channel_id") and not merged.get("channel_id"):
        merged["channel_id"] = meta["channel_id"]
    if not (merged.get("uploader") or merged.get("channel")):
        uploader = meta.get("uploader") or meta.get("channel")
        if uploader:
            merged["uploader"] = uploader
    if meta.get("description") and not merged.get("description"):
        merged["description"] = meta["description"]
    return merged


async def _enrich_search_entries(entries: list[dict]) -> list[dict]:
    if not entries:
        return []

    sem = asyncio.Semaphore(_ENRICH_CONCURRENCY)

    async def enrich_one(entry: dict) -> dict:
        if not _entry_needs_enrichment(entry):
            return entry
        video_id = entry.get("id")
        if not video_id:
            return entry
        async with sem:
            meta = await asyncio.to_thread(_metadata_sync, video_id)
        if not meta:
            return entry
        return _merge_entry_metadata(entry, meta)

    return list(await asyncio.gather(*(enrich_one(entry) for entry in entries)))


def entry_to_search_result(entry: dict) -> SearchResult | None:
    video_id = entry.get("id")
    if not video_id:
        return None
    raw_title = (entry.get("title") or "").strip()
    parsed_artist, parsed_title = parse_artist_title(raw_title)
    uploader = entry.get("uploader") or entry.get("channel") or parsed_artist
    duration = entry.get("duration")
    duration_sec = int(duration) if isinstance(duration, (int, float)) and duration else None
    description = entry.get("description")
    short_description = None
    if isinstance(description, str):
        short_description = description.strip()[:280] or None
    channel_id = entry.get("channel_id")
    if isinstance(channel_id, str):
        channel_id = channel_id.strip() or None
    else:
        channel_id = None
    return SearchResult(
        video_id=video_id,
        title=parsed_title or raw_title or video_id,
        artist=uploader,
        thumbnail_url=youtube_thumbnail_url(video_id),
        duration_sec=duration_sec,
        source_title=raw_title or None,
        short_description=short_description,
        channel_id=channel_id,
    )


async def search_music_candidates(
    query: str,
    *,
    limit: int = 20,
    enrich: bool = True,
) -> list[SearchResult]:
    """YouTube search via yt-dlp for when Piped instances are unavailable.

    Flat search is fast and usually includes duration/uploader; sparse hits are
    optionally enriched with a short metadata probe.
    """
    capped = max(1, min(int(limit), 50))
    try:
        entries = await search_video_entries(query, limit=capped)
    except Exception:
        return []
    if enrich:
        entries = await _enrich_search_entries(entries)
    results: list[SearchResult] = []
    for entry in entries:
        result = entry_to_search_result(entry)
        if result is not None:
            results.append(result)
    return results


def _stream_info_from_audio(info: dict, video_id: str) -> StreamInfo:
    direct_url = info.get("url")
    if not direct_url:
        raise ValueError("No audio stream available for this video")

    artist, title = parse_artist_title(info.get("title", "Unknown"))
    return StreamInfo(
        video_id=video_id,
        title=title,
        artist=artist or info.get("uploader") or info.get("channel"),
        thumbnail_url=youtube_thumbnail_url(video_id),
        duration_sec=info.get("duration"),
        audio_url=direct_url,
        mime_type=_mime_from_info(info, default_prefix="audio"),
    )


async def get_stream_via_ytdlp(video_id: str) -> StreamInfo:
    audio_info = await asyncio.to_thread(_extract_sync, video_id, format_selector=_AUDIO_FORMAT)
    stream = _stream_info_from_audio(audio_info, video_id)

    try:
        video_info = await asyncio.to_thread(_extract_sync, video_id, format_selector=_VIDEO_AV_FORMAT)
        if video_info.get("url") or video_info.get("requested_formats"):
            stream.has_video = True
            stream.video_mime_type = _mime_from_info(video_info, default_prefix="video")
    except Exception:
        stream.has_video = False

    return stream


def _pipe_ytdlp_to_queue(video_id: str, queue: Queue, *, format_selector: str) -> None:
    url = f"https://www.youtube.com/watch?v={video_id}"
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "yt_dlp",
            "-f",
            format_selector,
            "-o",
            "-",
            "--quiet",
            "--no-warnings",
            url,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    try:
        assert proc.stdout is not None
        while True:
            chunk = proc.stdout.read(65536)
            if not chunk:
                break
            queue.put(chunk)
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait()
        stderr = proc.stderr.read().decode("utf-8", errors="replace").strip() if proc.stderr else ""
        if proc.returncode not in (0, None) and queue.empty():
            queue.put(RuntimeError(stderr or f"yt-dlp failed with exit code {proc.returncode}"))
        queue.put(_SENTINEL)


async def _stream_via_ytdlp(video_id: str, *, format_selector: str) -> AsyncIterator[bytes]:
    if not _YT_ID_RE.match(video_id):
        raise ValueError("Invalid video id")

    queue: Queue = Queue(maxsize=8)
    worker = Thread(
        target=_pipe_ytdlp_to_queue,
        args=(video_id, queue),
        kwargs={"format_selector": format_selector},
        daemon=True,
    )
    worker.start()

    while True:
        item = await asyncio.to_thread(queue.get)
        if item is _SENTINEL:
            break
        if isinstance(item, Exception):
            raise item
        yield item

    worker.join(timeout=1)


async def stream_audio_via_ytdlp(video_id: str) -> AsyncIterator[bytes]:
    async for chunk in _stream_via_ytdlp(video_id, format_selector=_AUDIO_FORMAT):
        yield chunk


async def stream_video_via_ytdlp(video_id: str, *, video_only: bool = False) -> AsyncIterator[bytes]:
    format_selector = _VIDEO_ONLY_FORMAT if video_only else _VIDEO_AV_FORMAT
    async for chunk in _stream_via_ytdlp(video_id, format_selector=format_selector):
        yield chunk
