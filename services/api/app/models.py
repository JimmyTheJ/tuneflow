import enum
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ScrobblerProvider(str, enum.Enum):
    lastfm = "lastfm"
    librefm = "librefm"


class Household(Base):
    __tablename__ = "households"
    __table_args__ = (UniqueConstraint("slug", name="uq_household_slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    slug: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    is_system: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
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
    playlists: Mapped[list["Playlist"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    play_history: Mapped[list["PlayHistory"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    likes: Mapped[list["Like"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    scrobbler_connections: Mapped[list["ScrobblerConnection"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[User] = relationship(back_populates="playlists")
    tracks: Mapped[list["PlaylistTrack"]] = relationship(
        back_populates="playlist", cascade="all, delete-orphan", order_by="PlaylistTrack.position"
    )


class PlaylistTrack(Base):
    __tablename__ = "playlist_tracks"
    __table_args__ = (UniqueConstraint("playlist_id", "video_id", name="uq_playlist_video"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    playlist_id: Mapped[int] = mapped_column(ForeignKey("playlists.id", ondelete="CASCADE"))
    video_id: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    artist: Mapped[str | None] = mapped_column(String(300), nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    duration_sec: Mapped[int | None] = mapped_column(Integer, nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    playlist: Mapped[Playlist] = relationship(back_populates="tracks")


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
