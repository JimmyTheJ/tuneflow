from collections.abc import AsyncIterator

import httpx

from app.schemas import StreamInfo
from app.services.piped import (
    artist_matches,
    is_topic_upload,
    matches_requested_track,
    piped_client,
    title_matches,
)
from app.services.ytdlp import get_stream_via_ytdlp, search_video_ids, stream_audio_via_ytdlp


def _proxy_audio_url(video_id: str) -> str:
    return f"/api/music/audio/{video_id}"


async def _probe_fetchable(url: str) -> bool:
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            response = await client.get(url, headers={"Range": "bytes=0-4095"})
            if response.status_code not in (200, 206):
                return False
            body = response.content
            if not body:
                return False
            content_type = response.headers.get("content-type", "")
            if "text/html" in content_type or body.startswith(b"<"):
                return False
            return True
    except httpx.HTTPError:
        return False


async def _find_playable_alternate(
    original_video_id: str,
    title: str,
    artist: str | None,
) -> StreamInfo | None:
    query = " ".join(part for part in [artist, title] if part).strip()
    if not query:
        return None

    ranked_candidates: list[tuple[int, str]] = []
    seen: set[str] = {original_video_id}

    try:
        for video_id in await search_video_ids(query, limit=15):
            if video_id in seen:
                continue
            seen.add(video_id)
            ranked_candidates.append((0, video_id))
    except Exception:
        pass

    try:
        for result in await piped_client.search_piped(query, limit=12):
            if result.video_id in seen or is_topic_upload(result.artist):
                continue
            seen.add(result.video_id)
            score = 0
            if not title_matches(title, result.title):
                score += 4
            if not artist_matches(artist, result.artist):
                score += 2
            ranked_candidates.append((score, result.video_id))
    except httpx.HTTPError:
        pass

    for _, video_id in sorted(ranked_candidates, key=lambda item: (item[0], item[1])):
        try:
            stream = await get_stream_via_ytdlp(video_id)
        except Exception:
            continue
        if not matches_requested_track(
            wanted_title=title,
            wanted_artist=artist,
            candidate_title=stream.title,
            candidate_artist=stream.artist,
        ):
            continue
        return stream
    return None


async def resolve_stream(video_id: str) -> StreamInfo:
    errors: list[str] = []
    piped_meta: StreamInfo | None = None

    try:
        stream = await get_stream_via_ytdlp(video_id)
        stream.audio_url = _proxy_audio_url(video_id)
        return stream
    except Exception as exc:
        errors.append(f"yt-dlp: {exc}")

    try:
        piped_meta = await piped_client.get_stream(video_id)
        if await _probe_fetchable(piped_meta.audio_url):
            piped_meta.audio_url = _proxy_audio_url(video_id)
            return piped_meta
        errors.append("piped: stream URL is not fetchable")
    except (httpx.HTTPError, ValueError) as exc:
        errors.append(f"piped: {exc}")

    if piped_meta is not None:
        alternate = await _find_playable_alternate(video_id, piped_meta.title, piped_meta.artist)
        if alternate is not None:
            alternate.audio_url = _proxy_audio_url(alternate.video_id)
            return alternate

    raise httpx.HTTPError("Could not resolve audio stream. " + "; ".join(errors))


async def stream_audio_chunks(video_id: str) -> AsyncIterator[bytes]:
    errors: list[str] = []

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

    try:
        stream = await piped_client.get_stream(video_id)
        if not await _probe_fetchable(stream.audio_url):
            raise ValueError("stream URL is not fetchable")

        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            async with client.stream("GET", stream.audio_url) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    yield chunk
        return
    except (httpx.HTTPError, ValueError) as exc:
        errors.append(f"piped: {exc}")

    raise httpx.HTTPError("Could not stream audio. " + "; ".join(errors))
