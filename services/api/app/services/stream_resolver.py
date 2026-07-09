from collections.abc import AsyncIterator

import httpx

from app.schemas import StreamInfo
from app.services.piped import piped_client
from app.services.ytdlp import get_stream_via_ytdlp, stream_audio_via_ytdlp


async def resolve_stream(video_id: str) -> StreamInfo:
    errors: list[str] = []

    try:
        stream = await piped_client.get_stream(video_id)
        stream.audio_url = f"/api/music/audio/{video_id}"
        return stream
    except (httpx.HTTPError, ValueError) as exc:
        errors.append(f"piped: {exc}")

    try:
        stream = await get_stream_via_ytdlp(video_id)
        stream.audio_url = f"/api/music/audio/{video_id}"
        return stream
    except Exception as exc:
        errors.append(f"yt-dlp: {exc}")

    raise httpx.HTTPError("Could not resolve audio stream. " + "; ".join(errors))


async def stream_audio_chunks(video_id: str) -> AsyncIterator[bytes]:
    errors: list[str] = []

    try:
        stream = await piped_client.get_stream(video_id)

        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            async with client.stream("GET", stream.audio_url) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    yield chunk
        return
    except (httpx.HTTPError, ValueError) as exc:
        errors.append(f"piped: {exc}")

    try:
        got_bytes = False
        async for chunk in stream_audio_via_ytdlp(video_id):
            got_bytes = True
            yield chunk
        if got_bytes:
            return
        errors.append("yt-dlp: no audio data returned")
    except Exception as exc:
        message = str(exc).strip() or repr(exc)
        errors.append(f"yt-dlp: {message}")

    raise httpx.HTTPError("Could not stream audio. " + "; ".join(errors))
