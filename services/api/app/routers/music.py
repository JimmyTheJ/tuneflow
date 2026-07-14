import httpx
import json
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
from app.schemas import (
    AlbumDetail,
    AlbumResolveResult,
    ArtistDetail,
    ArtistSearchHit,
    CatalogTrack,
    ReleaseSummary,
    SearchResult,
    SearchResultsPage,
    StreamInfo,
)
from app.services.cache_manager import resolve_audio, resolve_stream_with_cache
from app.services.catalog_resolver import resolve_catalog_tracks
from app.services.musicbrainz import musicbrainz_client
from app.services.piped import piped_client
from app.services.stream_resolver import stream_video_chunks
from app.services.ytdlp import stream_audio_via_ytdlp
from app.slugify import build_track_filename

router = APIRouter(prefix="/music", tags=["music"])


def _piped_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=502,
        detail=f"Could not play this track: {exc}",
    )


def _catalog_track_from_mb(track, *, resolved=None, blocked_reason: str | None = None) -> CatalogTrack:
    duration_sec = None
    if track.duration_ms:
        duration_sec = max(1, round(track.duration_ms / 1000))
    return CatalogTrack(
        position=track.position,
        title=track.title,
        recording_mbid=track.recording_mbid,
        duration_ms=track.duration_ms,
        artist_name=track.artist_name,
        video_id=resolved.video_id if resolved else None,
        thumbnail_url=resolved.thumbnail_url if resolved else None,
        duration_sec=resolved.duration_sec if resolved and resolved.duration_sec else duration_sec,
        blocked_reason=blocked_reason,
        resolved=resolved is not None,
    )


def _apply_resolution(
    track: CatalogTrack,
    *,
    artist_name: str,
    resolved,
    blocked_reason: str | None,
) -> CatalogTrack:
    duration_sec = resolved.duration_sec
    if not duration_sec and track.duration_ms:
        duration_sec = max(1, round(track.duration_ms / 1000))
    return CatalogTrack(
        position=track.position,
        title=track.title,
        recording_mbid=track.recording_mbid,
        duration_ms=track.duration_ms,
        artist_name=track.artist_name or artist_name,
        video_id=resolved.video_id,
        thumbnail_url=resolved.thumbnail_url,
        duration_sec=duration_sec,
        blocked_reason=blocked_reason,
        resolved=True,
    )


async def _search_artists_for_query(query: str) -> list[ArtistSearchHit]:
    try:
        hits = await musicbrainz_client.search_artists(query)
    except httpx.HTTPError:
        return []

    return [
        ArtistSearchHit(
            mbid=hit.mbid,
            name=hit.name,
            type=hit.type,
            score=hit.score,
            disambiguation=hit.disambiguation,
            image_url=hit.image_url,
        )
        for hit in hits
    ]


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
        return SearchResultsPage(results=[], artists=[], next_page=None)

    artist_hits: list[ArtistSearchHit] = []
    if not next_page:
        artist_hits = await _search_artists_for_query(q)

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
    return SearchResultsPage(results=filtered, artists=artist_hits, next_page=next_token)


@router.get("/artists/{mbid}", response_model=ArtistDetail)
async def get_artist(
    mbid: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ArtistDetail:
    await enforce_child_access(db, current_user)
    try:
        detail = await musicbrainz_client.get_artist_detail(mbid)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not load artist: {exc}") from exc

    return ArtistDetail(
        mbid=detail.mbid,
        name=detail.name,
        type=detail.type,
        disambiguation=detail.disambiguation,
        image_url=detail.image_url,
        albums=[ReleaseSummary.model_validate(r.__dict__) for r in detail.albums],
        eps=[ReleaseSummary.model_validate(r.__dict__) for r in detail.eps],
        singles=[ReleaseSummary.model_validate(r.__dict__) for r in detail.singles],
    )


@router.get("/artists/{mbid}/stream")
async def stream_artist(
    mbid: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    await enforce_child_access(db, current_user)

    async def event_stream():
        try:
            async for event in musicbrainz_client.stream_artist_detail(mbid):
                yield json.dumps(event) + "\n"
        except httpx.HTTPError as exc:
            yield json.dumps({"event": "error", "data": {"message": str(exc)}}) + "\n"

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@router.get("/albums/{mbid}", response_model=AlbumDetail)
async def get_album(
    mbid: str,
    resolve: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AlbumDetail:
    child_settings = await enforce_child_access(db, current_user)
    try:
        detail = await musicbrainz_client.get_album_detail(mbid)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not load album: {exc}") from exc

    catalog_tracks = [
        _catalog_track_from_mb(track)
        for track in detail.tracks
    ]

    if resolve:
        catalog_tracks = await _resolve_album_tracks(catalog_tracks, detail.artist_name, child_settings)

    return AlbumDetail(
        mbid=detail.mbid,
        title=detail.title,
        artist_name=detail.artist_name,
        artist_mbid=detail.artist_mbid,
        release_date=detail.release_date,
        release_type=detail.release_type,
        cover_url=detail.cover_url,
        tracks=catalog_tracks,
    )


async def _resolve_album_tracks(
    tracks: list[CatalogTrack],
    artist_name: str,
    child_settings,
) -> list[CatalogTrack]:
    unresolved = [(i, t) for i, t in enumerate(tracks) if not t.resolved]
    if not unresolved:
        return tracks

    resolved_list = await resolve_catalog_tracks(
        [(artist_name, t.title, t.recording_mbid) for _, t in unresolved],
        concurrency=3,
    )

    updated = list(tracks)
    for (index, track), resolved in zip(unresolved, resolved_list, strict=True):
        if not resolved:
            updated[index] = track
            continue
        blocked = check_content_allowed(
            settings=child_settings,
            video_id=resolved.video_id,
            title=resolved.title,
            artist=resolved.artist,
        )
        updated[index] = _apply_resolution(
            track,
            artist_name=artist_name,
            resolved=resolved,
            blocked_reason=blocked,
        )
    return updated


@router.post("/albums/{mbid}/resolve", response_model=AlbumResolveResult)
async def resolve_album_tracks(
    mbid: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AlbumResolveResult:
    child_settings = await enforce_child_access(db, current_user)
    try:
        detail = await musicbrainz_client.get_album_detail(mbid)
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Could not load album: {exc}") from exc

    catalog_tracks = [_catalog_track_from_mb(track) for track in detail.tracks]
    resolved_tracks = await _resolve_album_tracks(catalog_tracks, detail.artist_name, child_settings)
    return AlbumResolveResult(tracks=resolved_tracks)


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
        stream = await resolve_stream_with_cache(
            db,
            video_id,
            title=title,
            artist=artist,
            user_id=current_user.id,
        )
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


@router.get("/audio/{video_id}", response_model=None)
async def stream_audio(
    video_id: str,
    title: str | None = Query(default=None),
    artist: str | None = Query(default=None),
    download: bool = Query(default=False),
    current_user: User = Depends(get_current_user_from_token),
    db: AsyncSession = Depends(get_db),
):
    child_settings = await enforce_child_access(db, current_user)

    try:
        stream = await resolve_stream_with_cache(
            db,
            video_id,
            title=title,
            artist=artist,
            user_id=current_user.id,
        )
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
            stream=stream,
        )
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise _piped_unavailable(exc) from exc

    filename = (
        build_track_filename(stream.title, artist=stream.artist, suffix=resolution.path.suffix)
        if download
        else f"{stream.video_id}{resolution.path.suffix}"
    )
    cache_headers = {"Cache-Control": "no-store"} if resolution.stream else {"Cache-Control": "private, max-age=3600"}
    disposition = {"Content-Disposition": f'attachment; filename="{filename}"'} if download else {}

    if resolution.stream:
        async def iter_bytes():
            async for chunk in stream_audio_via_ytdlp(stream.video_id):
                yield chunk

        return StreamingResponse(
            iter_bytes(),
            media_type=resolution.mime_type,
            headers={**cache_headers, **disposition},
        )

    return FileResponse(
        resolution.path,
        media_type=resolution.mime_type,
        filename=filename,
        headers={**cache_headers, **disposition},
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
        stream = await resolve_stream_with_cache(
            db,
            video_id,
            user_id=current_user.id,
        )
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
