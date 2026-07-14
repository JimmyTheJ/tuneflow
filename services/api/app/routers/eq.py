import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.auth import get_current_user
from app.database import get_db
from app.models import EqPlaylistAssignment, EqProfile, EqTrackAssignment, Playlist, User
from app.schemas import (
    EqAssignmentRead,
    EqBand,
    EqBulkTrackAssignment,
    EqBulkTrackResult,
    EqPlaylistAssignmentUpdate,
    EqProfileCreate,
    EqProfileRead,
    EqProfileUpdate,
    EqResolveResult,
    EqTrackAssignmentUpdate,
)

router = APIRouter(prefix="/eq", tags=["eq"])

DEFAULT_BANDS: list[dict[str, float | int]] = [
    {"freq": 32, "gainDb": 0},
    {"freq": 64, "gainDb": 0},
    {"freq": 125, "gainDb": 0},
    {"freq": 250, "gainDb": 0},
    {"freq": 500, "gainDb": 0},
    {"freq": 1000, "gainDb": 0},
    {"freq": 2000, "gainDb": 0},
    {"freq": 4000, "gainDb": 0},
    {"freq": 8000, "gainDb": 0},
    {"freq": 16000, "gainDb": 0},
]

STARTER_PRESETS: list[tuple[str, list[dict[str, float | int]]]] = [
    ("Flat", DEFAULT_BANDS),
    (
        "Bass Boost",
        [
            {"freq": 32, "gainDb": 6},
            {"freq": 64, "gainDb": 5},
            {"freq": 125, "gainDb": 3},
            {"freq": 250, "gainDb": 1},
            {"freq": 500, "gainDb": 0},
            {"freq": 1000, "gainDb": 0},
            {"freq": 2000, "gainDb": 0},
            {"freq": 4000, "gainDb": 0},
            {"freq": 8000, "gainDb": 0},
            {"freq": 16000, "gainDb": 0},
        ],
    ),
    (
        "Treble",
        [
            {"freq": 32, "gainDb": 0},
            {"freq": 64, "gainDb": 0},
            {"freq": 125, "gainDb": 0},
            {"freq": 250, "gainDb": 0},
            {"freq": 500, "gainDb": 0},
            {"freq": 1000, "gainDb": 1},
            {"freq": 2000, "gainDb": 2},
            {"freq": 4000, "gainDb": 4},
            {"freq": 8000, "gainDb": 5},
            {"freq": 16000, "gainDb": 6},
        ],
    ),
    (
        "Vocal",
        [
            {"freq": 32, "gainDb": -2},
            {"freq": 64, "gainDb": -1},
            {"freq": 125, "gainDb": 0},
            {"freq": 250, "gainDb": 1},
            {"freq": 500, "gainDb": 2},
            {"freq": 1000, "gainDb": 3},
            {"freq": 2000, "gainDb": 3},
            {"freq": 4000, "gainDb": 2},
            {"freq": 8000, "gainDb": 0},
            {"freq": 16000, "gainDb": -1},
        ],
    ),
]


def serialize_bands(bands: list[EqBand]) -> str:
    payload = [{"freq": band.freq, "gainDb": band.gain_db} for band in bands]
    return json.dumps(payload)


def parse_bands(raw: str) -> list[EqBand]:
    data = json.loads(raw)
    return [EqBand.model_validate(item) for item in data]


def profile_read(profile: EqProfile) -> EqProfileRead:
    return EqProfileRead(
        id=profile.id,
        name=profile.name,
        bands=parse_bands(profile.bands_json),
        preamp_db=profile.preamp_db,
        is_default=profile.is_default,
        created_at=profile.created_at,
        updated_at=profile.updated_at,
    )


async def _get_owned_profile(db: AsyncSession, profile_id: int, user_id: int) -> EqProfile:
    result = await db.execute(
        select(EqProfile).where(EqProfile.id == profile_id, EqProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="EQ profile not found")
    return profile


async def _get_owned_playlist(db: AsyncSession, playlist_id: int, user_id: int) -> Playlist:
    result = await db.execute(
        select(Playlist)
        .options(selectinload(Playlist.tracks))
        .where(
            Playlist.id == playlist_id,
            Playlist.user_id == user_id,
            Playlist.deleted_at.is_(None),
        )
    )
    playlist = result.scalar_one_or_none()
    if playlist is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Playlist not found")
    return playlist


async def _ensure_starter_profiles(db: AsyncSession, user_id: int) -> None:
    result = await db.execute(select(EqProfile.id).where(EqProfile.user_id == user_id).limit(1))
    if result.scalar_one_or_none() is not None:
        return

    for index, (name, bands) in enumerate(STARTER_PRESETS):
        db.add(
            EqProfile(
                user_id=user_id,
                name=name,
                bands_json=json.dumps(bands),
                preamp_db=0.0,
                is_default=index == 0,
            )
        )
    await db.commit()


@router.get("/profiles", response_model=list[EqProfileRead])
async def list_profiles(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[EqProfileRead]:
    await _ensure_starter_profiles(db, current_user.id)
    result = await db.execute(
        select(EqProfile)
        .where(EqProfile.user_id == current_user.id)
        .order_by(EqProfile.is_default.desc(), EqProfile.name.asc())
    )
    return [profile_read(row) for row in result.scalars().all()]


@router.post("/profiles", response_model=EqProfileRead, status_code=status.HTTP_201_CREATED)
async def create_profile(
    payload: EqProfileCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EqProfileRead:
    profile = EqProfile(
        user_id=current_user.id,
        name=payload.name,
        bands_json=serialize_bands(payload.bands),
        preamp_db=payload.preamp_db,
        is_default=False,
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return profile_read(profile)


@router.get("/profiles/{profile_id}", response_model=EqProfileRead)
async def get_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EqProfileRead:
    profile = await _get_owned_profile(db, profile_id, current_user.id)
    return profile_read(profile)


@router.patch("/profiles/{profile_id}", response_model=EqProfileRead)
async def update_profile(
    profile_id: int,
    payload: EqProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EqProfileRead:
    profile = await _get_owned_profile(db, profile_id, current_user.id)
    if payload.name is not None:
        profile.name = payload.name
    if payload.bands is not None:
        profile.bands_json = serialize_bands(payload.bands)
    if payload.preamp_db is not None:
        profile.preamp_db = payload.preamp_db
    await db.commit()
    await db.refresh(profile)
    return profile_read(profile)


@router.delete("/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    profile = await _get_owned_profile(db, profile_id, current_user.id)
    await db.execute(delete(EqTrackAssignment).where(EqTrackAssignment.eq_profile_id == profile_id))
    await db.execute(delete(EqPlaylistAssignment).where(EqPlaylistAssignment.eq_profile_id == profile_id))
    await db.delete(profile)
    await db.commit()


@router.post("/profiles/{profile_id}/set-default", response_model=EqProfileRead)
async def set_default_profile(
    profile_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EqProfileRead:
    profile = await _get_owned_profile(db, profile_id, current_user.id)
    await db.execute(
        update(EqProfile)
        .where(EqProfile.user_id == current_user.id)
        .values(is_default=False)
    )
    profile.is_default = True
    await db.commit()
    await db.refresh(profile)
    return profile_read(profile)


@router.get("/tracks/{video_id}", response_model=EqAssignmentRead)
async def get_track_assignment(
    video_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EqAssignmentRead:
    result = await db.execute(
        select(EqTrackAssignment)
        .options(selectinload(EqTrackAssignment.eq_profile))
        .where(EqTrackAssignment.user_id == current_user.id, EqTrackAssignment.video_id == video_id)
    )
    assignment = result.scalar_one_or_none()
    if assignment is None:
        return EqAssignmentRead(eq_profile_id=None, profile=None)
    return EqAssignmentRead(
        eq_profile_id=assignment.eq_profile_id,
        profile=profile_read(assignment.eq_profile),
    )


@router.put("/tracks/{video_id}", response_model=EqAssignmentRead)
async def set_track_assignment(
    video_id: str,
    payload: EqTrackAssignmentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EqAssignmentRead:
    if payload.eq_profile_id is None:
        await db.execute(
            delete(EqTrackAssignment).where(
                EqTrackAssignment.user_id == current_user.id,
                EqTrackAssignment.video_id == video_id,
            )
        )
        await db.commit()
        return EqAssignmentRead(eq_profile_id=None, profile=None)

    profile = await _get_owned_profile(db, payload.eq_profile_id, current_user.id)
    result = await db.execute(
        select(EqTrackAssignment).where(
            EqTrackAssignment.user_id == current_user.id,
            EqTrackAssignment.video_id == video_id,
        )
    )
    assignment = result.scalar_one_or_none()
    if assignment is None:
        assignment = EqTrackAssignment(
            user_id=current_user.id,
            video_id=video_id,
            eq_profile_id=profile.id,
        )
        db.add(assignment)
    else:
        assignment.eq_profile_id = profile.id
    await db.commit()
    await db.refresh(assignment)
    return EqAssignmentRead(eq_profile_id=profile.id, profile=profile_read(profile))


@router.post("/tracks/bulk", response_model=EqBulkTrackResult)
async def bulk_track_assignment(
    payload: EqBulkTrackAssignment,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EqBulkTrackResult:
    unique_ids = list(dict.fromkeys(payload.video_ids))
    if payload.eq_profile_id is None:
        result = await db.execute(
            delete(EqTrackAssignment).where(
                EqTrackAssignment.user_id == current_user.id,
                EqTrackAssignment.video_id.in_(unique_ids),
            )
        )
        await db.commit()
        return EqBulkTrackResult(updated=0, cleared=result.rowcount or 0)

    profile = await _get_owned_profile(db, payload.eq_profile_id, current_user.id)
    updated = 0
    for video_id in unique_ids:
        result = await db.execute(
            select(EqTrackAssignment).where(
                EqTrackAssignment.user_id == current_user.id,
                EqTrackAssignment.video_id == video_id,
            )
        )
        assignment = result.scalar_one_or_none()
        if assignment is None:
            db.add(
                EqTrackAssignment(
                    user_id=current_user.id,
                    video_id=video_id,
                    eq_profile_id=profile.id,
                )
            )
        else:
            assignment.eq_profile_id = profile.id
        updated += 1
    await db.commit()
    return EqBulkTrackResult(updated=updated, cleared=0)


@router.get("/playlists/{playlist_id}", response_model=EqAssignmentRead)
async def get_playlist_assignment(
    playlist_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EqAssignmentRead:
    await _get_owned_playlist(db, playlist_id, current_user.id)
    result = await db.execute(
        select(EqPlaylistAssignment)
        .options(selectinload(EqPlaylistAssignment.eq_profile))
        .where(
            EqPlaylistAssignment.user_id == current_user.id,
            EqPlaylistAssignment.playlist_id == playlist_id,
        )
    )
    assignment = result.scalar_one_or_none()
    if assignment is None:
        return EqAssignmentRead(eq_profile_id=None, profile=None)
    return EqAssignmentRead(
        eq_profile_id=assignment.eq_profile_id,
        profile=profile_read(assignment.eq_profile),
    )


@router.put("/playlists/{playlist_id}", response_model=EqAssignmentRead)
async def set_playlist_assignment(
    playlist_id: int,
    payload: EqPlaylistAssignmentUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EqAssignmentRead:
    await _get_owned_playlist(db, playlist_id, current_user.id)
    if payload.eq_profile_id is None:
        await db.execute(
            delete(EqPlaylistAssignment).where(
                EqPlaylistAssignment.user_id == current_user.id,
                EqPlaylistAssignment.playlist_id == playlist_id,
            )
        )
        await db.commit()
        return EqAssignmentRead(eq_profile_id=None, profile=None)

    profile = await _get_owned_profile(db, payload.eq_profile_id, current_user.id)
    result = await db.execute(
        select(EqPlaylistAssignment).where(
            EqPlaylistAssignment.user_id == current_user.id,
            EqPlaylistAssignment.playlist_id == playlist_id,
        )
    )
    assignment = result.scalar_one_or_none()
    if assignment is None:
        assignment = EqPlaylistAssignment(
            user_id=current_user.id,
            playlist_id=playlist_id,
            eq_profile_id=profile.id,
        )
        db.add(assignment)
    else:
        assignment.eq_profile_id = profile.id
    await db.commit()
    await db.refresh(assignment)
    return EqAssignmentRead(eq_profile_id=profile.id, profile=profile_read(profile))


@router.post("/playlists/{playlist_id}/apply-to-tracks", response_model=EqBulkTrackResult)
async def apply_playlist_eq_to_tracks(
    playlist_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EqBulkTrackResult:
    playlist = await _get_owned_playlist(db, playlist_id, current_user.id)
    result = await db.execute(
        select(EqPlaylistAssignment).where(
            EqPlaylistAssignment.user_id == current_user.id,
            EqPlaylistAssignment.playlist_id == playlist_id,
        )
    )
    assignment = result.scalar_one_or_none()
    if assignment is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Playlist has no EQ profile assigned",
        )

    video_ids = [track.video_id for track in playlist.tracks]
    if not video_ids:
        return EqBulkTrackResult(updated=0, cleared=0)

    bulk_payload = EqBulkTrackAssignment(video_ids=video_ids, eq_profile_id=assignment.eq_profile_id)
    return await bulk_track_assignment(bulk_payload, current_user, db)


@router.post("/playlists/{playlist_id}/clear-track-eqs", response_model=EqBulkTrackResult)
async def clear_playlist_track_eqs(
    playlist_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EqBulkTrackResult:
    playlist = await _get_owned_playlist(db, playlist_id, current_user.id)
    video_ids = [track.video_id for track in playlist.tracks]
    if not video_ids:
        return EqBulkTrackResult(updated=0, cleared=0)
    bulk_payload = EqBulkTrackAssignment(video_ids=video_ids, eq_profile_id=None)
    return await bulk_track_assignment(bulk_payload, current_user, db)


@router.get("/resolve", response_model=EqResolveResult)
async def resolve_eq(
    video_id: str = Query(min_length=6, max_length=20),
    playlist_id: int | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> EqResolveResult:
    track_result = await db.execute(
        select(EqTrackAssignment)
        .options(selectinload(EqTrackAssignment.eq_profile))
        .where(EqTrackAssignment.user_id == current_user.id, EqTrackAssignment.video_id == video_id)
    )
    track_assignment = track_result.scalar_one_or_none()
    if track_assignment is not None:
        return EqResolveResult(
            profile=profile_read(track_assignment.eq_profile),
            source="track",
        )

    if playlist_id is not None:
        await _get_owned_playlist(db, playlist_id, current_user.id)
        playlist_result = await db.execute(
            select(EqPlaylistAssignment)
            .options(selectinload(EqPlaylistAssignment.eq_profile))
            .where(
                EqPlaylistAssignment.user_id == current_user.id,
                EqPlaylistAssignment.playlist_id == playlist_id,
            )
        )
        playlist_assignment = playlist_result.scalar_one_or_none()
        if playlist_assignment is not None:
            return EqResolveResult(
                profile=profile_read(playlist_assignment.eq_profile),
                source="playlist",
            )

    default_result = await db.execute(
        select(EqProfile).where(EqProfile.user_id == current_user.id, EqProfile.is_default.is_(True))
    )
    default_profile = default_result.scalar_one_or_none()
    if default_profile is not None:
        return EqResolveResult(profile=profile_read(default_profile), source="default")

    return EqResolveResult(profile=None, source="flat")
