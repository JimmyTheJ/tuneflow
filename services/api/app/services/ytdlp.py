import asyncio
import re
import subprocess
import sys
from collections.abc import AsyncIterator
from queue import Empty, Queue
from threading import Thread

import yt_dlp

from app.schemas import StreamInfo
from app.services.piped import parse_artist_title

_YT_ID_RE = re.compile(r"^[a-zA-Z0-9_-]{6,20}$")
_SENTINEL = object()


def _extract_sync(video_id: str) -> dict:
    if not _YT_ID_RE.match(video_id):
        raise ValueError("Invalid video id")
    url = f"https://www.youtube.com/watch?v={video_id}"
    with yt_dlp.YoutubeDL(
        {
            "quiet": True,
            "no_warnings": True,
            "format": "bestaudio/best",
            "noplaylist": True,
        }
    ) as ydl:
        return ydl.extract_info(url, download=False)


async def get_stream_via_ytdlp(video_id: str) -> StreamInfo:
    info = await asyncio.to_thread(_extract_sync, video_id)
    direct_url = info.get("url")
    if not direct_url:
        raise ValueError("No audio stream available for this video")

    artist, title = parse_artist_title(info.get("title", "Unknown"))
    return StreamInfo(
        video_id=video_id,
        title=title,
        artist=artist or info.get("uploader") or info.get("channel"),
        thumbnail_url=info.get("thumbnail"),
        duration_sec=info.get("duration"),
        audio_url=direct_url,
    )


def _pipe_ytdlp_to_queue(video_id: str, queue: Queue) -> None:
    url = f"https://www.youtube.com/watch?v={video_id}"
    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "yt_dlp",
            "-f",
            "bestaudio/best",
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


async def stream_audio_via_ytdlp(video_id: str) -> AsyncIterator[bytes]:
    if not _YT_ID_RE.match(video_id):
        raise ValueError("Invalid video id")

    queue: Queue = Queue(maxsize=8)
    worker = Thread(target=_pipe_ytdlp_to_queue, args=(video_id, queue), daemon=True)
    worker.start()

    while True:
        item = await asyncio.to_thread(queue.get)
        if item is _SENTINEL:
            break
        if isinstance(item, Exception):
            raise item
        yield item

    worker.join(timeout=1)
