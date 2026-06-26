from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.database import get_db
from app.models import Playlist, PlaylistTrack, User
from app.schemas import (
    PlaylistCreate,
    PlaylistDetail,
    PlaylistRead,
    PlaylistTrackCreate,
    PlaylistTrackRead,
    PlaylistUpdate,
    ReorderTracksRequest,
)

router = APIRouter(prefix="/playlists", tags=["playlists"])


def _playlist_read(playlist: Playlist) -> PlaylistRead:
    return PlaylistRead(
        id=playlist.id,
        name=playlist.name,
        description=playlist.description,
        created_at=playlist.created_at,
        updated_at=playlist.updated_at,
        track_count=len(playlist.tracks),
    )


async def _get_owned_playlist(db: AsyncSession, playlist_id: int, user_id: int) -> Playlist:
    result = await db.execute(
        select(Playlist)
        .options(selectinload(Playlist.tracks))
        .where(Playlist.id == playlist_id, Playlist.user_id == user_id)
    )
    playlist = result.scalar_one_or_none()
    if playlist is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Playlist not found")
    return playlist


@router.get("", response_model=list[PlaylistRead])
async def list_playlists(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[PlaylistRead]:
    result = await db.execute(
        select(Playlist)
        .options(selectinload(Playlist.tracks))
        .where(Playlist.user_id == current_user.id)
        .order_by(Playlist.updated_at.desc())
    )
    return [_playlist_read(playlist) for playlist in result.scalars().all()]


@router.post("", response_model=PlaylistRead, status_code=status.HTTP_201_CREATED)
async def create_playlist(
    payload: PlaylistCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PlaylistRead:
    playlist = Playlist(user_id=current_user.id, name=payload.name, description=payload.description)
    db.add(playlist)
    await db.commit()
    await db.refresh(playlist)
    return _playlist_read(playlist)


@router.get("/{playlist_id}", response_model=PlaylistDetail)
async def get_playlist(
    playlist_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PlaylistDetail:
    playlist = await _get_owned_playlist(db, playlist_id, current_user.id)
    detail = PlaylistDetail.model_validate(playlist, from_attributes=True)
    detail.track_count = len(playlist.tracks)
    detail.tracks = [PlaylistTrackRead.model_validate(track, from_attributes=True) for track in playlist.tracks]
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
    await db.commit()
    await db.refresh(playlist)
    return _playlist_read(playlist)


@router.delete("/{playlist_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_playlist(
    playlist_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    playlist = await _get_owned_playlist(db, playlist_id, current_user.id)
    await db.delete(playlist)
    await db.commit()


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
    )
    db.add(track)
    await db.commit()
    await db.refresh(track)
    return PlaylistTrackRead.model_validate(track, from_attributes=True)


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
    return [PlaylistTrackRead.model_validate(track, from_attributes=True) for track in ordered]
