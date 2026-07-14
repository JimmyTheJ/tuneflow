import asyncio
from collections.abc import AsyncIterator

import httpx

from app.retry import is_transient_ytdlp_failure, with_retry
from app.schemas import StreamInfo
from app.services.piped import (
    artist_matches,
    collect_video_playback_streams,
    is_topic_upload,
    looks_like_live_version,
    matches_requested_track,
    piped_client,
    title_matches,
)
from app.services.ytdlp import (
    get_stream_via_ytdlp,
    search_video_ids,
    stream_audio_via_ytdlp,
    stream_video_via_ytdlp,
)


def _proxy_audio_url(video_id: str) -> str:
    return f"/api/music/audio/{video_id}"


def _proxy_video_url(video_id: str) -> str:
    return f"/api/music/video/{video_id}"


def _apply_proxy_urls(stream: StreamInfo) -> StreamInfo:
    playable_id = stream.video_id
    stream.playable_video_id = playable_id
    stream.audio_url = _proxy_audio_url(playable_id)
    if stream.has_video:
        stream.video_url = _proxy_video_url(playable_id)
    else:
        stream.video_url = None
    return stream


async def _probe_fetchable_once(url: str) -> bool:
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


async def _probe_fetchable(url: str) -> bool:
    for attempt in range(2):
        try:
            if await _probe_fetchable_once(url):
                return True
        except httpx.HTTPError:
            pass
        if attempt == 0:
            await asyncio.sleep(0.5)
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
        results, _ = await piped_client.search_piped(query, limit=12)
        for result in results:
            if result.video_id in seen or is_topic_upload(result.artist):
                continue
            seen.add(result.video_id)
            # Lower score wins. Prefer studio alternates unless the original is live.
            score = 0
            if not title_matches(title, result.title):
                score += 4
            if not artist_matches(artist, result.artist):
                score += 2
            if looks_like_live_version(result.title) and not looks_like_live_version(title):
                score += 3
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


async def _lookup_track_metadata(
    video_id: str,
    title: str | None,
    artist: str | None,
) -> tuple[str, str | None]:
    if title:
        return title, artist

    try:
        piped_meta = await piped_client.get_stream(video_id)
        return piped_meta.title, piped_meta.artist
    except (httpx.HTTPError, ValueError):
        pass

    try:
        results, _ = await piped_client.search_piped(video_id, limit=5)
        for result in results:
            if result.video_id == video_id:
                return result.title, result.artist
    except httpx.HTTPError:
        pass

    return "Unknown", None


async def resolve_stream(
    video_id: str,
    *,
    title: str | None = None,
    artist: str | None = None,
) -> StreamInfo:
    errors: list[str] = []

    try:
        stream = await with_retry(
            lambda: get_stream_via_ytdlp(video_id),
            max_attempts=2,
            should_retry=is_transient_ytdlp_failure,
        )
        return _apply_proxy_urls(stream)
    except Exception as exc:
        errors.append(f"yt-dlp: {exc}")

    resolved_title, resolved_artist = await _lookup_track_metadata(video_id, title, artist)
    alternate = await _find_playable_alternate(video_id, resolved_title, resolved_artist)
    if alternate is not None:
        return _apply_proxy_urls(alternate)

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


async def stream_video_chunks(video_id: str, *, video_only: bool = False) -> AsyncIterator[bytes]:
    errors: list[str] = []

    try:
        got_bytes = False
        async for chunk in stream_video_via_ytdlp(video_id, video_only=video_only):
            got_bytes = True
            yield chunk
        if got_bytes:
            return
        errors.append("yt-dlp: no video data returned")
    except Exception as exc:
        message = str(exc).strip() or repr(exc)
        errors.append(f"yt-dlp: {message}")

    if video_only:
        raise httpx.HTTPError("Could not stream video-only. " + "; ".join(errors))

    try:
        payload = await piped_client._request_json(f"/streams/{video_id}")
        video_streams = collect_video_playback_streams(payload)
        if not video_streams:
            raise ValueError("No video stream available for this video")
        best = max(video_streams, key=lambda s: s.get("bitrate", 0) or 0)
        video_url = best["url"]
        if not await _probe_fetchable(video_url):
            raise ValueError("video stream URL is not fetchable")

        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            async with client.stream("GET", video_url) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    yield chunk
        return
    except (httpx.HTTPError, ValueError) as exc:
        errors.append(f"piped: {exc}")

    raise httpx.HTTPError("Could not stream video. " + "; ".join(errors))
