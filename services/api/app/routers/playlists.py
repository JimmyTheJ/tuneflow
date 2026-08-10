from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import assert_same_household, get_current_user, require_playlist_recovery_admin
from app.database import get_db
from app.models import (
    MatchStatus,
    Playlist,
    PlaylistSourceType,
    PlaylistTrack,
    PlaylistVisibility,
    User,
)
from app.schemas import (
    DeletedPlaylistRead,
    PlaylistCreate,
    PlaylistDetail,
    PlaylistMatchSummary,
    PlaylistRead,
    PlaylistTrackCreate,
    PlaylistTrackRead,
    PlaylistUpdate,
    ReorderTracksRequest,
)
from app.services.cache_manager import get_system_settings

router = APIRouter(prefix="/playlists", tags=["playlists"])


def _enum_value(value: object) -> str:
    return value.value if hasattr(value, "value") else str(value)


def _match_summary(tracks: list[PlaylistTrack]) -> PlaylistMatchSummary:
    matched = unmatched = pending = 0
    for track in tracks:
        status_value = _enum_value(track.match_status)
        if status_value == MatchStatus.matched.value:
            matched += 1
        elif status_value == MatchStatus.unmatched.value:
            unmatched += 1
        else:
            pending += 1
    return PlaylistMatchSummary(matched=matched, unmatched=unmatched, pending=pending)


def _playlist_read(playlist: Playlist, *, viewer: User) -> PlaylistRead:
    is_owner = playlist.user_id == viewer.id
    owner = playlist.user if getattr(playlist, "user", None) is not None else None
    return PlaylistRead(
        id=playlist.id,
        name=playlist.name,
        description=playlist.description,
        visibility=_enum_value(playlist.visibility),  # type: ignore[arg-type]
        source_type=_enum_value(getattr(playlist, "source_type", PlaylistSourceType.manual)),  # type: ignore[arg-type]
        source_url=getattr(playlist, "source_url", None),
        owner_id=playlist.user_id,
        owner_display_name=owner.display_name if owner else None,
        is_owner=is_owner,
        created_at=playlist.created_at,
        updated_at=playlist.updated_at,
        track_count=len(playlist.tracks),
        match_summary=_match_summary(playlist.tracks),
    )


def _track_read(track: PlaylistTrack) -> PlaylistTrackRead:
    return PlaylistTrackRead.model_validate(track, from_attributes=True)


def _active_playlist_filter():
    return Playlist.deleted_at.is_(None)


async def _load_playlist_with_tracks(db: AsyncSession, playlist_id: int) -> Playlist:
    result = await db.execute(
        select(Playlist)
        .options(selectinload(Playlist.tracks), selectinload(Playlist.user))
        .where(Playlist.id == playlist_id, _active_playlist_filter())
    )
    return result.scalar_one()


async def _get_owned_playlist(db: AsyncSession, playlist_id: int, user_id: int) -> Playlist:
    result = await db.execute(
        select(Playlist)
        .options(selectinload(Playlist.tracks), selectinload(Playlist.user))
        .where(Playlist.id == playlist_id, Playlist.user_id == user_id, _active_playlist_filter())
    )
    playlist = result.scalar_one_or_none()
    if playlist is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Playlist not found")
    return playlist


async def _can_view_playlist(viewer: User, playlist: Playlist) -> bool:
    if playlist.user_id == viewer.id:
        return True
    visibility = _enum_value(playlist.visibility)
    if visibility != PlaylistVisibility.household.value:
        return False
    owner = playlist.user
    if owner is None:
        return False
    if viewer.household_id is None or owner.household_id is None:
        return False
    return viewer.household_id == owner.household_id


async def _get_viewable_playlist(db: AsyncSession, playlist_id: int, viewer: User) -> Playlist:
    result = await db.execute(
        select(Playlist)
        .options(selectinload(Playlist.tracks), selectinload(Playlist.user))
        .where(Playlist.id == playlist_id, _active_playlist_filter())
    )
    playlist = result.scalar_one_or_none()
    if playlist is None or not await _can_view_playlist(viewer, playlist):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Playlist not found")
    return playlist


async def _get_deleted_playlist_for_recovery(
    db: AsyncSession,
    playlist_id: int,
    actor: User,
) -> Playlist:
    result = await db.execute(
        select(Playlist)
        .options(
            selectinload(Playlist.tracks),
            selectinload(Playlist.user),
            selectinload(Playlist.deleted_by),
        )
        .where(Playlist.id == playlist_id, Playlist.deleted_at.isnot(None))
    )
    playlist = result.scalar_one_or_none()
    if playlist is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Deleted playlist not found")
    await assert_same_household(actor, playlist.user)
    return playlist


def _deleted_playlist_read(playlist: Playlist, retention_days: int) -> DeletedPlaylistRead:
    expires_at = None
    if retention_days > 0 and playlist.deleted_at is not None:
        expires_at = playlist.deleted_at + timedelta(days=retention_days)
    return DeletedPlaylistRead(
        id=playlist.id,
        name=playlist.name,
        description=playlist.description,
        track_count=len(playlist.tracks),
        deleted_at=playlist.deleted_at,
        deleted_by_display_name=playlist.deleted_by.display_name if playlist.deleted_by else None,
        owner_id=playlist.user.id,
        owner_display_name=playlist.user.display_name,
        owner_username=playlist.user.username,
        expires_at=expires_at,
    )


@router.get("", response_model=list[PlaylistRead])
async def list_playlists(
    scope: str = Query(default="mine", pattern="^(mine|household)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PlaylistRead]:
    if scope == "mine":
        result = await db.execute(
            select(Playlist)
            .options(selectinload(Playlist.tracks), selectinload(Playlist.user))
            .where(Playlist.user_id == current_user.id, _active_playlist_filter())
            .order_by(Playlist.updated_at.desc())
        )
        return [_playlist_read(playlist, viewer=current_user) for playlist in result.scalars().all()]

    if current_user.household_id is None:
        return []

    result = await db.execute(
        select(Playlist)
        .join(User, Playlist.user_id == User.id)
        .options(selectinload(Playlist.tracks), selectinload(Playlist.user))
        .where(
            _active_playlist_filter(),
            Playlist.visibility == PlaylistVisibility.household,
            User.household_id == current_user.household_id,
            Playlist.user_id != current_user.id,
        )
        .order_by(Playlist.updated_at.desc())
    )
    return [_playlist_read(playlist, viewer=current_user) for playlist in result.scalars().unique().all()]


@router.get("/deleted", response_model=list[DeletedPlaylistRead])
async def list_deleted_playlists(
    current_user: User = Depends(require_playlist_recovery_admin),
    db: AsyncSession = Depends(get_db),
) -> list[DeletedPlaylistRead]:
    settings = await get_system_settings(db)
    query = (
        select(Playlist)
        .options(
            selectinload(Playlist.tracks),
            selectinload(Playlist.user),
            selectinload(Playlist.deleted_by),
        )
        .where(Playlist.deleted_at.isnot(None))
        .order_by(Playlist.deleted_at.desc())
    )
    if not current_user.is_root_admin:
        query = query.join(User, Playlist.user_id == User.id).where(
            User.household_id == current_user.household_id
        )
    result = await db.execute(query)
    return [
        _deleted_playlist_read(playlist, settings.playlist_retention_days)
        for playlist in result.scalars().unique().all()
    ]


@router.post("", response_model=PlaylistRead, status_code=status.HTTP_201_CREATED)
async def create_playlist(
    payload: PlaylistCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PlaylistRead:
    playlist = Playlist(
        user_id=current_user.id,
        name=payload.name,
        description=payload.description,
        visibility=PlaylistVisibility(payload.visibility),
        source_type=PlaylistSourceType.manual,
    )
    db.add(playlist)
    await db.commit()
    await db.refresh(playlist)
    playlist = await _load_playlist_with_tracks(db, playlist.id)
    return _playlist_read(playlist, viewer=current_user)


@router.get("/{playlist_id}", response_model=PlaylistDetail)
async def get_playlist(
    playlist_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PlaylistDetail:
    playlist = await _get_viewable_playlist(db, playlist_id, current_user)
    detail = PlaylistDetail(**_playlist_read(playlist, viewer=current_user).model_dump())
    detail.tracks = [_track_read(track) for track in playlist.tracks]
    return detail


@router.patch("/{playlist_id}", response_model=PlaylistRead)
async def update_playlist(
    playlist_id: int,
    payload: PlaylistUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PlaylistRead:
    playlist = await _get_owned_playlist(db, playlist_id, current_user.id)
    if payload.name is not None:
        playlist.name = payload.name
    if payload.description is not None:
        playlist.description = payload.description
    if payload.visibility is not None:
        playlist.visibility = PlaylistVisibility(payload.visibility)
    await db.commit()
    playlist = await _get_owned_playlist(db, playlist_id, current_user.id)
    return _playlist_read(playlist, viewer=current_user)


@router.delete("/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_playlist(
    playlist_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    playlist = await _get_owned_playlist(db, playlist_id, current_user.id)
    playlist.deleted_at = datetime.now(UTC)
    playlist.deleted_by_user_id = current_user.id
    await db.commit()


@router.post("/{playlist_id}/restore", response_model=PlaylistRead)
async def restore_playlist(
    playlist_id: int,
    current_user: User = Depends(require_playlist_recovery_admin),
    db: AsyncSession = Depends(get_db),
) -> PlaylistRead:
    playlist = await _get_deleted_playlist_for_recovery(db, playlist_id, current_user)
    playlist.deleted_at = None
    playlist.deleted_by_user_id = None
    await db.commit()
    playlist = await _load_playlist_with_tracks(db, playlist.id)
    return _playlist_read(playlist, viewer=current_user)


@router.post("/{playlist_id}/copy", response_model=PlaylistRead, status_code=status.HTTP_201_CREATED)
async def copy_playlist(
    playlist_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PlaylistRead:
    source = await _get_viewable_playlist(db, playlist_id, current_user)
    copy_name = source.name if source.user_id == current_user.id else f"{source.name} (copy)"
    playlist = Playlist(
        user_id=current_user.id,
        name=copy_name[:200],
        description=source.description,
        visibility=PlaylistVisibility.private,
        source_type=source.source_type,
        source_url=source.source_url,
        source_external_id=source.source_external_id,
    )
    db.add(playlist)
    await db.flush()
    for track in source.tracks:
        db.add(
            PlaylistTrack(
                playlist_id=playlist.id,
                video_id=track.video_id,
                title=track.title,
                artist=track.artist,
                thumbnail_url=track.thumbnail_url,
                duration_sec=track.duration_sec,
                position=track.position,
                match_status=track.match_status,
                match_score=track.match_score,
                source_title=track.source_title,
                source_artist=track.source_artist,
                source_duration_ms=track.source_duration_ms,
                source_spotify_id=track.source_spotify_id,
            )
        )
    await db.commit()
    playlist = await _load_playlist_with_tracks(db, playlist.id)
    return _playlist_read(playlist, viewer=current_user)


@router.post("/{playlist_id}/tracks", response_model=PlaylistTrackRead, status_code=status.HTTP_201_CREATED)
async def add_track(
    playlist_id: int,
    payload: PlaylistTrackCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PlaylistTrackRead:
    playlist = await _get_owned_playlist(db, playlist_id, current_user.id)

    existing = await db.execute(
        select(PlaylistTrack).where(
            PlaylistTrack.playlist_id == playlist_id, PlaylistTrack.video_id == payload.video_id
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Track already in playlist")

    if payload.position is None:
        max_pos = await db.scalar(
            select(func.coalesce(func.max(PlaylistTrack.position), -1)).where(
                PlaylistTrack.playlist_id == playlist_id
            )
        )
        position = (max_pos or -1) + 1
    else:
        position = payload.position

    track = PlaylistTrack(
        playlist_id=playlist_id,
        video_id=payload.video_id,
        title=payload.title,
        artist=payload.artist,
        thumbnail_url=payload.thumbnail_url,
        duration_sec=payload.duration_sec,
        position=position,
        match_status=MatchStatus.matched,
        source_title=payload.title,
        source_artist=payload.artist,
    )
    db.add(track)
    await db.commit()
    await db.refresh(track)
    return _track_read(track)


@router.delete("/{playlist_id}/tracks/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_track(
    playlist_id: int,
    track_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    await _get_owned_playlist(db, playlist_id, current_user.id)
    result = await db.execute(
        select(PlaylistTrack).where(PlaylistTrack.id == track_id, PlaylistTrack.playlist_id == playlist_id)
    )
    track = result.scalar_one_or_none()
    if track is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Track not found")
    await db.delete(track)
    await db.commit()


@router.post("/{playlist_id}/tracks/reorder", response_model=list[PlaylistTrackRead])
async def reorder_tracks(
    playlist_id: int,
    payload: ReorderTracksRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PlaylistTrackRead]:
    await _get_owned_playlist(db, playlist_id, current_user.id)
    result = await db.execute(select(PlaylistTrack).where(PlaylistTrack.playlist_id == playlist_id))
    tracks = {track.id: track for track in result.scalars().all()}

    if set(payload.track_ids) != set(tracks.keys()):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="track_ids must match playlist tracks")

    for position, track_id in enumerate(payload.track_ids):
        tracks[track_id].position = position

    await db.commit()
    ordered = sorted(tracks.values(), key=lambda track: track.position)
    return [_track_read(track) for track in ordered]
