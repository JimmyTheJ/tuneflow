import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, Float, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ScrobblerProvider(str, enum.Enum):
    lastfm = "lastfm"
    librefm = "librefm"


class PlaylistVisibility(str, enum.Enum):
    private = "private"
    household = "household"


class PlaylistSourceType(str, enum.Enum):
    manual = "manual"
    youtube = "youtube"
    spotify = "spotify"


class MatchStatus(str, enum.Enum):
    pending = "pending"
    matched = "matched"
    unmatched = "unmatched"


class ImportJobProvider(str, enum.Enum):
    youtube = "youtube"
    spotify = "spotify"


class ImportJobStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class Household(Base):
    __tablename__ = "households"
    __table_args__ = (UniqueConstraint("slug", name="uq_household_slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    search_defaults_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    members: Mapped[list["User"]] = relationship(back_populates="household")
    role_profiles: Mapped[list["RoleProfile"]] = relationship(back_populates="owner_household")


class RoleProfile(Base):
    __tablename__ = "role_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    slug: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    owner_household_id: Mapped[int] = mapped_column(ForeignKey("households.id", ondelete="CASCADE"), index=True)
    is_global: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_public: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    permissions: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    owner_household: Mapped[Household] = relationship(back_populates="role_profiles")
    assignments: Mapped[list["UserRoleAssignment"]] = relationship(back_populates="role_profile")


class UserRoleAssignment(Base):
    __tablename__ = "user_role_assignments"
    __table_args__ = (UniqueConstraint("user_id", "role_profile_id", name="uq_user_role_profile"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role_profile_id: Mapped[int] = mapped_column(ForeignKey("role_profiles.id", ondelete="CASCADE"), index=True)

    user: Mapped["User"] = relationship(back_populates="role_assignments")
    role_profile: Mapped[RoleProfile] = relationship(back_populates="assignments")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("household_id", "username", name="uq_household_username"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    household_id: Mapped[int | None] = mapped_column(ForeignKey("households.id", ondelete="SET NULL"), nullable=True, index=True)
    is_root_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    parent_pin_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    household: Mapped[Household | None] = relationship(back_populates="members")
    role_assignments: Mapped[list[UserRoleAssignment]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    parental_settings: Mapped["ParentalSettings | None"] = relationship(
        back_populates="child_user", uselist=False, cascade="all, delete-orphan"
    )
    playlists: Mapped[list["Playlist"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="Playlist.user_id",
    )
    play_history: Mapped[list["PlayHistory"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    likes: Mapped[list["Like"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    scrobbler_connections: Mapped[list["ScrobblerConnection"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    eq_profiles: Mapped[list["EqProfile"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    eq_track_assignments: Mapped[list["EqTrackAssignment"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    eq_playlist_assignments: Mapped[list["EqPlaylistAssignment"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    channel_pins: Mapped[list["UserChannelPin"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UserChannelPin(Base):
    __tablename__ = "user_channel_pins"
    __table_args__ = (UniqueConstraint("user_id", "artist_key", name="uq_user_channel_pin_artist"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    artist_key: Mapped[str] = mapped_column(String(200), nullable=False)
    channel_name: Mapped[str] = mapped_column(String(300), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped["User"] = relationship(back_populates="channel_pins")


class ParentalSettings(Base):
    __tablename__ = "parental_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    child_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    block_explicit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    search_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    max_daily_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    allowed_start_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    allowed_end_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=23)
    blocked_keywords: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    blocked_video_ids: Mapped[str] = mapped_column(Text, nullable=False, default="[]")
    search_advanced_hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    search_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    search_max_versions_ceiling: Mapped[int | None] = mapped_column(Integer, nullable=True)
    search_force_clean: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    child_user: Mapped[User] = relationship(back_populates="parental_settings")


class Playlist(Base):
    __tablename__ = "playlists"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    visibility: Mapped[PlaylistVisibility] = mapped_column(
        Enum(PlaylistVisibility), nullable=False, default=PlaylistVisibility.private
    )
    source_type: Mapped[PlaylistSourceType] = mapped_column(
        Enum(PlaylistSourceType), nullable=False, default=PlaylistSourceType.manual
    )
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_external_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    import_job_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    deleted_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="playlists", foreign_keys=[user_id])
    deleted_by: Mapped["User | None"] = relationship(foreign_keys=[deleted_by_user_id])
    tracks: Mapped[list["PlaylistTrack"]] = relationship(
        back_populates="playlist", cascade="all, delete-orphan", order_by="PlaylistTrack.position"
    )


class PlaylistTrack(Base):
    __tablename__ = "playlist_tracks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    playlist_id: Mapped[int] = mapped_column(ForeignKey("playlists.id", ondelete="CASCADE"), index=True)
    video_id: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    artist: Mapped[str | None] = mapped_column(String(300), nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    match_status: Mapped[MatchStatus] = mapped_column(
        Enum(MatchStatus), nullable=False, default=MatchStatus.matched
    )
    match_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source_artist: Mapped[str | None] = mapped_column(String(300), nullable=True)
    source_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_spotify_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    playlist: Mapped[Playlist] = relationship(back_populates="tracks")


class ImportJob(Base):
    __tablename__ = "import_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[ImportJobProvider] = mapped_column(Enum(ImportJobProvider), nullable=False)
    status: Mapped[ImportJobStatus] = mapped_column(
        Enum(ImportJobStatus), nullable=False, default=ImportJobStatus.queued
    )
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_external_id: Mapped[str | None] = mapped_column(String(120), nullable=True)
    requested_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    visibility: Mapped[PlaylistVisibility] = mapped_column(
        Enum(PlaylistVisibility), nullable=False, default=PlaylistVisibility.private
    )
    progress_done: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    progress_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    result_playlist_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    options_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship()


class PlayHistory(Base):
    __tablename__ = "play_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    video_id: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    artist: Mapped[str | None] = mapped_column(String(300), nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    listened_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    played_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    user: Mapped[User] = relationship(back_populates="play_history")


class ScrobblerConnection(Base):
    __tablename__ = "scrobbler_connections"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_user_scrobbler_provider"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[ScrobblerProvider] = mapped_column(Enum(ScrobblerProvider), nullable=False)
    username: Mapped[str] = mapped_column(String(120), nullable=False)
    session_key: Mapped[str] = mapped_column(String(255), nullable=False)
    scrobbling_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    linked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="scrobbler_connections")


class Like(Base):
    __tablename__ = "likes"
    __table_args__ = (UniqueConstraint("user_id", "video_id", name="uq_user_like_video"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    video_id: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    artist: Mapped[str | None] = mapped_column(String(300), nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    liked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="likes")


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    cache_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    cache_retention_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_refresh_days: Mapped[int] = mapped_column(Integer, nullable=False, default=180)
    cache_max_size_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cache_cleanup_interval_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=24)
    catalog_cache_retention_days: Mapped[int | None] = mapped_column(Integer, nullable=True, default=7)
    catalog_cache_max_size_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    playlist_retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=90)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AudioCacheEntry(Base):
    __tablename__ = "audio_cache_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    video_id: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    mime_type: Mapped[str] = mapped_column(String(80), nullable=False, default="application/octet-stream")
    cached_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_accessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    last_verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cached_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    artist: Mapped[str | None] = mapped_column(String(300), nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    duration_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    has_video: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    video_mime_type: Mapped[str | None] = mapped_column(String(80), nullable=True)

    cached_by_user: Mapped[User | None] = relationship()
    access_records: Mapped[list["AudioCacheAccess"]] = relationship(
        back_populates="cache_entry", cascade="all, delete-orphan"
    )


class CatalogCacheEntry(Base):
    __tablename__ = "catalog_cache_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cache_key: Mapped[str] = mapped_column(String(500), unique=True, nullable=False, index=True)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    cached_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class EqProfile(Base):
    __tablename__ = "eq_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    bands_json: Mapped[str] = mapped_column(Text, nullable=False)
    preamp_db: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="eq_profiles")
    track_assignments: Mapped[list["EqTrackAssignment"]] = relationship(back_populates="eq_profile")
    playlist_assignments: Mapped[list["EqPlaylistAssignment"]] = relationship(back_populates="eq_profile")


class EqTrackAssignment(Base):
    __tablename__ = "eq_track_assignments"
    __table_args__ = (UniqueConstraint("user_id", "video_id", name="uq_eq_track_user_video"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    video_id: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    eq_profile_id: Mapped[int] = mapped_column(ForeignKey("eq_profiles.id", ondelete="CASCADE"), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="eq_track_assignments")
    eq_profile: Mapped[EqProfile] = relationship(back_populates="track_assignments")


class EqPlaylistAssignment(Base):
    __tablename__ = "eq_playlist_assignments"
    __table_args__ = (UniqueConstraint("user_id", "playlist_id", name="uq_eq_playlist_user_playlist"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    playlist_id: Mapped[int] = mapped_column(ForeignKey("playlists.id", ondelete="CASCADE"), index=True)
    eq_profile_id: Mapped[int] = mapped_column(ForeignKey("eq_profiles.id", ondelete="CASCADE"), index=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="eq_playlist_assignments")
    playlist: Mapped[Playlist] = relationship()
    eq_profile: Mapped[EqProfile] = relationship(back_populates="playlist_assignments")


class AudioCacheAccess(Base):
    __tablename__ = "audio_cache_access"
    __table_args__ = (UniqueConstraint("user_id", "video_id", name="uq_cache_access_user_video"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    video_id: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    cache_entry_id: Mapped[int] = mapped_column(ForeignKey("audio_cache_entries.id", ondelete="CASCADE"), index=True)
    first_accessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_accessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship()
    cache_entry: Mapped[AudioCacheEntry] = relationship(back_populates="access_records")
