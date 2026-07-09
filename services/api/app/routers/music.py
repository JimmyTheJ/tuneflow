import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    check_content_allowed,
    enforce_child_access,
    get_current_user,
    get_current_user_from_token,
)
from app.database import get_db
from app.models import User
from app.schemas import SearchResult, StreamInfo
from app.services.piped import piped_client
from app.services.stream_resolver import resolve_stream, stream_audio_chunks

router = APIRouter(prefix="/music", tags=["music"])


def _piped_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=502,
        detail=f"Could not play this track: {exc}",
    )


@router.get("/search", response_model=list[SearchResult])
async def search_music(
    q: str = Query(min_length=1),
    limit: int = Query(default=20, ge=1, le=50),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SearchResult]:
    child_settings = await enforce_child_access(db, current_user)
    if child_settings is not None and not child_settings.search_enabled:
        raise HTTPException(status_code=403, detail="Search is disabled for this account")

    blocked_query = check_content_allowed(settings=child_settings, query=q)
    if blocked_query:
        return []

    try:
        results = await piped_client.search(q, limit=limit)
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
                blocked_reason=reason,
            )
        )
    return filtered


@router.get("/stream/{video_id}", response_model=StreamInfo)
async def get_stream(
    video_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamInfo:
    child_settings = await enforce_child_access(db, current_user)

    try:
        stream = await resolve_stream(video_id)
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

    reason = check_content_allowed(
        settings=child_settings,
        video_id=stream.video_id,
        title=stream.title,
        artist=stream.artist,
    )
    if reason:
        raise HTTPException(status_code=403, detail=f"Content blocked: {reason}")

    async def iter_bytes():
        async for chunk in stream_audio_chunks(video_id):
            yield chunk

    return StreamingResponse(iter_bytes(), media_type="audio/webm")
