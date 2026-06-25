from datetime import datetime

from pydantic import BaseModel, Field


class TrackBase(BaseModel):
    video_id: str = Field(min_length=6, max_length=20)
    title: str
    artist: str | None = None
    thumbnail_url: str | None = None
    duration_sec: int | None = None


class TrackRead(TrackBase):
    pass


class PlaylistCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None


class PlaylistUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None


class PlaylistTrackCreate(TrackBase):
    position: int | None = None


class PlaylistTrackRead(TrackBase):
    id: int
    position: int
    added_at: datetime

    model_config = {"from_attributes": True}


class PlaylistRead(BaseModel):
    id: int
    name: str
    description: str | None
    created_at: datetime
    updated_at: datetime
    track_count: int = 0

    model_config = {"from_attributes": True}


class PlaylistDetail(PlaylistRead):
    tracks: list[PlaylistTrackRead] = []


class PlayHistoryCreate(TrackBase):
    listened_sec: int | None = Field(default=None, ge=0)


class PlayHistoryRead(TrackBase):
    id: int
    listened_sec: int | None
    played_at: datetime

    model_config = {"from_attributes": True}


class LikeRead(TrackBase):
    id: int
    liked_at: datetime

    model_config = {"from_attributes": True}


class SearchResult(TrackRead):
    pass


class StreamInfo(BaseModel):
    video_id: str
    title: str
    artist: str | None = None
    thumbnail_url: str | None = None
    duration_sec: int | None = None
    audio_url: str


class ReorderTracksRequest(BaseModel):
    track_ids: list[int] = Field(min_length=1)
