from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class UserRole(str, Enum):
    admin = "admin"
    parent = "parent"
    adult = "adult"
    child = "child"


class TrackBase(BaseModel):
    video_id: str = Field(min_length=6, max_length=20)
    title: str
    artist: str | None = None
    thumbnail_url: str | None = None
    duration_sec: int | None = None


class TrackRead(TrackBase):
    pass


class UserRead(BaseModel):
    id: int
    username: str
    display_name: str
    role: UserRole
    is_admin: bool
    is_active: bool
    deleted_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class LoginRequest(BaseModel):
    username: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=4, max_length=128)


class SetupRequest(BaseModel):
    username: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=4, max_length=128)
    display_name: str = Field(min_length=1, max_length=120)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserRead


class SetupStatus(BaseModel):
    needs_setup: bool


class UserCreate(BaseModel):
    username: str = Field(min_length=2, max_length=80)
    password: str = Field(min_length=4, max_length=128)
    display_name: str = Field(min_length=1, max_length=120)
    role: UserRole = UserRole.adult


class UserUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None


class ResetPasswordRequest(BaseModel):
    password: str = Field(min_length=4, max_length=128)


class ParentPinSet(BaseModel):
    pin: str = Field(min_length=4, max_length=12)


class ParentPinVerify(BaseModel):
    pin: str = Field(min_length=4, max_length=12)


class ParentPinStatus(BaseModel):
    has_pin: bool


class ParentPinEnforced(BaseModel):
    enforced: bool


class ParentPinVerifyResponse(BaseModel):
    valid: bool


class ChildUsageToday(BaseModel):
    child_user_id: int
    listened_minutes_today: int
    max_daily_minutes: int | None
    remaining_minutes: int | None


class ParentalSettingsRead(BaseModel):
    child_user_id: int
    block_explicit: bool
    search_enabled: bool
    max_daily_minutes: int | None
    allowed_start_hour: int = Field(ge=0, le=23)
    allowed_end_hour: int = Field(ge=0, le=23)
    blocked_keywords: list[str]
    blocked_video_ids: list[str]
    updated_at: datetime

    model_config = {"from_attributes": True}


class ParentalSettingsUpdate(BaseModel):
    block_explicit: bool | None = None
    search_enabled: bool | None = None
    max_daily_minutes: int | None = Field(default=None, ge=0, le=24 * 60)
    allowed_start_hour: int | None = Field(default=None, ge=0, le=23)
    allowed_end_hour: int | None = Field(default=None, ge=0, le=23)
    blocked_keywords: list[str] | None = None
    blocked_video_ids: list[str] | None = None


class ChildProfile(BaseModel):
    user: UserRead
    settings: ParentalSettingsRead


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
    blocked_reason: str | None = None
    source_title: str | None = None
    short_description: str | None = None


class SearchResultsPage(BaseModel):
    results: list[SearchResult]
    next_page: str | None = None


class StreamInfo(BaseModel):
    video_id: str
    title: str
    artist: str | None = None
    thumbnail_url: str | None = None
    duration_sec: int | None = None
    audio_url: str
    video_url: str | None = None
    mime_type: str = "audio/webm"
    video_mime_type: str | None = None
    has_video: bool = False
    playable_video_id: str | None = None


class ReorderTracksRequest(BaseModel):
    track_ids: list[int] = Field(min_length=1)


class LlmStatus(BaseModel):
    enabled: bool
    configured: bool
    reachable: bool
    base_url: str
    model: str
    detail: str | None = None


class AiSuggestion(BaseModel):
    query: str
    reason: str
    tracks: list[TrackRead] = []


class AiRecommendations(BaseModel):
    summary: str
    suggestions: list[AiSuggestion]


class AiInsights(BaseModel):
    summary: str
    top_artists: list[str]
    listening_patterns: list[str]
    recommendations: list[str]


class ScrobblerProviderInfo(BaseModel):
    id: str
    name: str


class ScrobblerConnectionRead(BaseModel):
    provider: str
    username: str
    scrobbling_enabled: bool
    linked_at: datetime

    model_config = {"from_attributes": True}


class ScrobblerConnectionStatus(BaseModel):
    provider: str
    configured: bool
    linked: bool
    username: str | None = None
    scrobbling_enabled: bool = False
    linked_at: datetime | None = None


class ScrobblerLinkStart(BaseModel):
    token: str
    authorize_url: str


class ScrobblerLinkComplete(BaseModel):
    token: str = Field(min_length=1, max_length=255)


class ScrobblerSettingsUpdate(BaseModel):
    scrobbling_enabled: bool


class CacheSettingsRead(BaseModel):
    cache_enabled: bool
    cache_retention_days: int | None = Field(default=None, ge=0)
    cache_max_size_mb: int | None = Field(default=None, ge=1)
    cache_cleanup_interval_hours: int = Field(ge=1, le=24 * 7)
    updated_at: datetime

    model_config = {"from_attributes": True}


class CacheSettingsUpdate(BaseModel):
    cache_enabled: bool | None = None
    cache_retention_days: int | None = Field(default=None, ge=0)
    cache_max_size_mb: int | None = Field(default=None, ge=1)
    cache_cleanup_interval_hours: int | None = Field(default=None, ge=1, le=24 * 7)


class CacheStats(BaseModel):
    entry_count: int
    total_size_bytes: int
    oldest_accessed_at: datetime | None
    newest_accessed_at: datetime | None
    unique_users: int


class CacheAccessUser(BaseModel):
    user_id: int
    username: str
    display_name: str
    first_accessed_at: datetime
    last_accessed_at: datetime


class CacheEntryRead(BaseModel):
    video_id: str
    title: str | None
    artist: str | None
    file_size_bytes: int
    mime_type: str
    cached_at: datetime
    last_accessed_at: datetime
    cached_by_user_id: int | None
    cached_by_username: str | None
    access_count: int
    users: list[CacheAccessUser]


class CachePurgeResult(BaseModel):
    deleted_entries: int
    freed_bytes: int


class CacheBulkDelete(BaseModel):
    video_ids: list[str] = Field(min_length=1, max_length=200)
