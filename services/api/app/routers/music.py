import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    check_content_allowed,
    enforce_child_access,
    get_current_user,
    get_current_user_from_token,
)
from app.database import get_db
from app.models import User
from app.schemas import SearchResult, SearchResultsPage, StreamInfo
from app.services.cache_manager import resolve_audio
from app.services.piped import piped_client
from app.services.stream_resolver import resolve_stream, stream_video_chunks
from app.services.ytdlp import stream_audio_via_ytdlp

router = APIRouter(prefix="/music", tags=["music"])


def _piped_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=502,
        detail=f"Could not play this track: {exc}",
    )


@router.get("/search", response_model=SearchResultsPage)
async def search_music(
    q: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=50),
    next_page: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SearchResultsPage:
    child_settings = await enforce_child_access(db, current_user)
    if child_settings is not None and not child_settings.search_enabled:
        raise HTTPException(status_code=403, detail="Search is disabled for this account")

    blocked_query = check_content_allowed(settings=child_settings, query=q)
    if blocked_query:
        return SearchResultsPage(results=[], next_page=None)

    try:
        if next_page:
            results, next_token = await piped_client.search_piped_next(q, next_page, limit=limit)
        else:
            results, next_token = await piped_client.search_piped(q, limit=limit)
    except httpx.HTTPError as exc:
        raise _piped_unavailable(exc) from exc

    filtered: list[SearchResult] = []
    for track in results:
        reason = check_content_allowed(
            settings=child_settings,
            video_id=track.video_id,
            title=track.title,
            artist=track.artist,
        )
        filtered.append(
            SearchResult(
                video_id=track.video_id,
                title=track.title,
                artist=track.artist,
                thumbnail_url=track.thumbnail_url,
                duration_sec=track.duration_sec,
                source_title=track.source_title,
                short_description=track.short_description,
                blocked_reason=reason,
            )
        )
    return SearchResultsPage(results=filtered, next_page=next_token)


@router.get("/stream/{video_id}", response_model=StreamInfo)
async def get_stream(
    video_id: str,
    title: str | None = Query(default=None),
    artist: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamInfo:
    child_settings = await enforce_child_access(db, current_user)

    try:
        stream = await resolve_stream(video_id, title=title, artist=artist)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise _piped_unavailable(exc) from exc

    reason = check_content_allowed(
        settings=child_settings,
        video_id=stream.video_id,
        title=stream.title,
        artist=stream.artist,
    )
    if reason:
        raise HTTPException(status_code=403, detail=f"Content blocked: {reason}")

    return stream


@router.get("/audio/{video_id}")
async def stream_audio(
    video_id: str,
    title: str | None = Query(default=None),
    artist: str | None = Query(default=None),
    current_user: User = Depends(get_current_user_from_token),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    child_settings = await enforce_child_access(db, current_user)

    try:
        stream = await resolve_stream(video_id, title=title, artist=artist)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise _piped_unavailable(exc) from exc

    reason = check_content_allowed(
        settings=child_settings,
        video_id=stream.video_id,
        title=stream.title,
        artist=stream.artist,
    )
    if reason:
        raise HTTPException(status_code=403, detail=f"Content blocked: {reason}")

    try:
        resolution = await resolve_audio(
            db,
            video_id=stream.video_id,
            user_id=current_user.id,
            title=stream.title,
            artist=stream.artist,
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise _piped_unavailable(exc) from exc

    if resolution.stream:
        async def iter_bytes():
            async for chunk in stream_audio_via_ytdlp(stream.video_id):
                yield chunk

        return StreamingResponse(
            iter_bytes(),
            media_type=resolution.mime_type,
            headers={"Cache-Control": "no-store"},
        )

    return FileResponse(
        resolution.path,
        media_type=resolution.mime_type,
        filename=f"{stream.video_id}{resolution.path.suffix}",
        headers={"Cache-Control": "private, max-age=3600"},
    )


@router.get("/video/{video_id}")
async def stream_video(
    video_id: str,
    video_only: bool = Query(default=False),
    current_user: User = Depends(get_current_user_from_token),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    child_settings = await enforce_child_access(db, current_user)

    try:
        stream = await resolve_stream(video_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise _piped_unavailable(exc) from exc

    if not stream.has_video:
        raise HTTPException(status_code=404, detail="No video stream available for this track")

    reason = check_content_allowed(
        settings=child_settings,
        video_id=stream.video_id,
        title=stream.title,
        artist=stream.artist,
    )
    if reason:
        raise HTTPException(status_code=403, detail=f"Content blocked: {reason}")

    playable_id = stream.video_id

    async def iter_bytes():
        async for chunk in stream_video_chunks(playable_id, video_only=video_only):
            yield chunk

    media_type = stream.video_mime_type or "video/mp4"
    return StreamingResponse(
        iter_bytes(),
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "no-store",
        },
    )
