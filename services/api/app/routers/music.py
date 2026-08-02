import json

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import (
    check_content_allowed,
    enforce_child_access,
    get_current_user,
    get_current_user_from_token,
)
from app.database import get_db
from app.models import User, UserChannelPin
from app.schemas import (
    AlbumDetail,
    AlbumResolveResult,
    ArtistDetail,
    ArtistSearchHit,
    CatalogTrack,
    ReleaseSummary,
    SearchResult,
    SearchResultsPage,
    SearchOptions,
    SearchOptionsUpdate,
    StreamInfo,
)
from app.services.cache_manager import resolve_audio, resolve_stream_with_cache
from app.services.catalog_resolver import resolve_catalog_tracks
from app.services.musicbrainz import musicbrainz_client
from app.services.piped import (
    apply_channel_pin_boost,
    drop_irrelevant_results,
    normalize_text,
    piped_client,
    rank_search_results,
    song_title_key,
)
from app.services.search_options import (
    SearchCursor,
    build_search_explanation,
    decode_search_cursor,
    encode_search_cursor,
    filter_search_results,
    max_per_song_from_query,
    options_fingerprint,
    resolve_search_options,
    trim_cursor_history,
)
from app.services.song_groups import (
    SongIdentity,
    artist_channel_ids,
    build_song_groups,
    candidate_titles_by_key,
    identity_for_song,
)
from app.services.stream_resolver import stream_audio_chunks, stream_video_chunks
from app.slugify import build_track_filename

router = APIRouter(prefix="/music", tags=["music"])

# MusicBrainz is rate limited to roughly one request per second, so only the
# leading songs of a page get a per-song lookup; the rest rely on the artist
# level match and duration consensus.
_SONG_LOOKUP_BUDGET = 3


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


async def _canonical_song(artist: str | None, title: str):
    try:
        if artist:
            return await musicbrainz_client.canonical_song_for_artist(artist, title)
        return await musicbrainz_client.canonical_song_by_title(title)
    except (httpx.HTTPError, ValueError):
        return None


def _dominant_uploader(results: list[SearchResult]) -> str | None:
    """The uploader behind most of these results, if one clearly leads."""
    counts: dict[str, int] = {}
    for result in results:
        name = (result.artist or "").strip()
        if name:
            counts[name] = counts.get(name, 0) + 1
    if not counts:
        return None
    name, count = max(counts.items(), key=lambda item: item[1])
    return name if count >= max(3, len(results) // 3) else None


def _query_artist_name(
    query: str,
    *,
    artist_hits: list[ArtistSearchHit],
    results: list[SearchResult],
) -> str | None:
    """The artist this search is about, when the query itself implies one."""
    normalized_query = normalize_text(query)
    for hit in artist_hits:
        hit_key = normalize_text(hit.name)
        if hit_key and hit_key in normalized_query and artist_channel_ids(results, hit.name):
            return hit.name
    dominant = _dominant_uploader(results)
    if dominant:
        dominant_key = normalize_text(dominant)
        if dominant_key and dominant_key in normalized_query:
            return dominant
    return None


async def _resolve_song_identities(
    query: str,
    results: list[SearchResult],
    *,
    artist_hits: list[ArtistSearchHit],
) -> dict[str, SongIdentity]:
    """Work out, per song, who the canonical artist is and how long their take runs.

    Resolving the artist once covers every song on the page without further
    lookups. Per-song MusicBrainz calls are rate limited upstream, so they are
    capped and best effort; duration consensus carries the remaining songs.
    """
    titles = candidate_titles_by_key(results)
    if not titles:
        return {}

    identities: dict[str, SongIdentity] = {}
    artist_name = _query_artist_name(query, artist_hits=artist_hits, results=results)
    if artist_name:
        channels = artist_channel_ids(results, artist_name)
        for key in titles:
            identities[key] = SongIdentity(artist_name=artist_name, artist_channel_ids=channels)

    ordered_keys: list[str] = []
    for result in results:
        key = song_title_key(result)
        if key and key in titles and key not in ordered_keys:
            ordered_keys.append(key)

    budget = _SONG_LOOKUP_BUDGET
    for key in ordered_keys:
        if budget <= 0:
            break
        existing = identities.get(key)
        if existing is not None and existing.duration_sec:
            continue
        budget -= 1
        song = await _canonical_song(artist_name, titles[key])
        if song is None or not song.artist_name:
            continue
        identities[key] = identity_for_song(
            canonical_artist=song.artist_name,
            canonical_duration_sec=song.duration_sec,
            recording_mbid=song.recording_mbid,
            candidates=results,
        )
    return identities


async def _load_channel_pins(db: AsyncSession, user_id: int) -> dict[str, str]:
    result = await db.execute(select(UserChannelPin).where(UserChannelPin.user_id == user_id))
    return {pin.artist_key: pin.channel_name for pin in result.scalars().all()}


def _apply_parental_blocks(
    results: list[SearchResult],
    *,
    child_settings,
) -> list[SearchResult]:
    filtered: list[SearchResult] = []
    for track in results:
        reason = check_content_allowed(
            settings=child_settings,
            video_id=track.video_id,
            title=track.title,
            artist=track.artist,
        )
        filtered.append(track.model_copy(update={"blocked_reason": reason}))
    return filtered


def _empty_search_page(
    *,
    effective_options: SearchOptions,
    search_advanced_hidden: bool = False,
) -> SearchResultsPage:
    return SearchResultsPage(
        groups=[],
        artists=[],
        next_page=None,
        effective_options=effective_options,
        explanation=None,
        search_advanced_hidden=search_advanced_hidden,
    )


@router.get("/search", response_model=SearchResultsPage)
async def search_music(
    q: str = Query(min_length=1),
    limit: int | None = Query(default=None, ge=1, le=50),
    next_page: str | None = Query(default=None),
    max_per_song: int | None = Query(default=None, ge=0, le=50),
    hide_covers: bool | None = Query(default=None),
    hide_loops: bool | None = Query(default=None),
    version_preference: str | None = Query(default=None, pattern="^(auto|studio|live|any)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SearchResultsPage:
    child_settings = await enforce_child_access(db, current_user)
    if child_settings is not None and not child_settings.search_enabled:
        raise HTTPException(status_code=403, detail="Search is disabled for this account")

    household = None
    if current_user.household_id is not None:
        result = await db.execute(
            select(User)
            .options(selectinload(User.household))
            .where(User.id == current_user.id)
        )
        loaded = result.scalar_one_or_none()
        if loaded is not None:
            household = loaded.household

    requested_updates: dict[str, object] = {}
    if max_per_song is not None:
        requested_updates["max_per_song"] = max_per_song_from_query(max_per_song)
    if hide_covers is not None:
        requested_updates["hide_covers"] = hide_covers
    if hide_loops is not None:
        requested_updates["hide_loops"] = hide_loops
    if limit is not None:
        requested_updates["results_per_page"] = limit
    if version_preference is not None:
        requested_updates["version_preference"] = version_preference

    requested = SearchOptionsUpdate(**requested_updates) if requested_updates else None
    requested_options = (
        SearchOptions.model_validate(requested.model_dump(exclude_unset=True)) if requested else None
    )
    effective_options = resolve_search_options(
        household=household,
        parental=child_settings,
        requested=requested_options,
    )
    fingerprint = options_fingerprint(effective_options)
    search_advanced_hidden = bool(child_settings and child_settings.search_advanced_hidden)

    blocked_query = check_content_allowed(settings=child_settings, query=q)
    if blocked_query:
        return _empty_search_page(
            effective_options=effective_options,
            search_advanced_hidden=search_advanced_hidden,
        )

    cursor = decode_search_cursor(next_page, expected_fingerprint=fingerprint)
    if cursor is None and next_page:
        raise HTTPException(status_code=400, detail="Search session expired. Run the search again.")

    # Cached upstream, so later pages reuse it to keep identifying canonical
    # artists even though only the first page renders artist cards.
    identity_hits = await _search_artists_for_query(q)
    artist_hits: list[ArtistSearchHit] = identity_hits if cursor is None else []

    seen_video_ids = list(cursor.seen_video_ids if cursor else [])
    emitted_group_keys = list(cursor.emitted_group_keys if cursor else [])
    seen_lookup = set(seen_video_ids)
    emitted_lookup = set(emitted_group_keys)
    piped_next = cursor.piped_nextpage if cursor else None
    channel_pins = await _load_channel_pins(db, current_user.id)

    try:
        raw_results, piped_token = await piped_client.collect_candidates(
            q,
            target=effective_options.results_per_page,
            next_page=piped_next,
            seen_video_ids=seen_lookup,
        )
    except httpx.HTTPError as exc:
        raise _piped_unavailable(exc) from exc

    for result in raw_results:
        if result.video_id not in seen_lookup:
            seen_lookup.add(result.video_id)
            seen_video_ids.append(result.video_id)

    if channel_pins:
        for artist_key, channel_name in channel_pins.items():
            raw_results = apply_channel_pin_boost(
                raw_results, artist_key=artist_key, channel_name=channel_name
            )
    ranked_results = rank_search_results(
        q,
        drop_irrelevant_results(q, raw_results),
        version_preference=effective_options.version_preference,
    )

    filtered_results, removed_count = filter_search_results(ranked_results, options=effective_options)
    blocked_results = _apply_parental_blocks(filtered_results, child_settings=child_settings)
    identities = await _resolve_song_identities(q, blocked_results, artist_hits=identity_hits)
    groups, collapsed = build_song_groups(
        blocked_results,
        max_per_song=effective_options.max_per_song,
        identities=identities,
        skip_group_keys=emitted_lookup,
    )
    for group in groups:
        if group.group_key not in emitted_lookup:
            emitted_lookup.add(group.group_key)
            emitted_group_keys.append(group.group_key)

    next_cursor = SearchCursor(
        piped_nextpage=piped_token,
        seen_video_ids=trim_cursor_history(seen_video_ids),
        emitted_group_keys=trim_cursor_history(emitted_group_keys),
        options_fingerprint=fingerprint,
    )
    next_token = encode_search_cursor(next_cursor)

    explanation = build_search_explanation(
        options=effective_options,
        household=household,
        parental=child_settings,
        filtered_count=removed_count,
        collapsed_count=collapsed,
    )

    return SearchResultsPage(
        groups=groups,
        artists=artist_hits,
        next_page=next_token,
        effective_options=effective_options,
        explanation=explanation,
        search_advanced_hidden=search_advanced_hidden,
    )


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
        except Exception as exc:
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
        catalog_tracks = await _resolve_album_tracks(
            catalog_tracks,
            detail.artist_name,
            child_settings,
            album_title=detail.title,
        )

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
    *,
    album_title: str | None = None,
) -> list[CatalogTrack]:
    unresolved = [(i, t) for i, t in enumerate(tracks) if not t.resolved]
    if not unresolved:
        return tracks

    resolved_list = await resolve_catalog_tracks(
        [(artist_name, t.title, t.recording_mbid, t.duration_ms) for _, t in unresolved],
        album_title=album_title,
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
    resolved_tracks = await _resolve_album_tracks(
        catalog_tracks,
        detail.artist_name,
        child_settings,
        album_title=detail.title,
    )
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
            async for chunk in stream_audio_chunks(stream.video_id):
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
