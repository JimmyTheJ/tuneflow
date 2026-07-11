import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import SessionLocal, get_db
from app.models import ScrobblerConnection, ScrobblerProvider, User
from app.schemas import (
    ScrobblerConnectionRead,
    ScrobblerConnectionStatus,
    ScrobblerLinkComplete,
    ScrobblerLinkStart,
    ScrobblerProviderInfo,
    ScrobblerSettingsUpdate,
)
from app.services.audioscrobbler import (
    audioscrobbler_client,
    get_provider,
    list_configured_providers,
    normalize_track_metadata,
    should_scrobble,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/scrobbler", tags=["scrobbler"])


def _parse_provider(provider_id: str) -> ScrobblerProvider:
    try:
        return ScrobblerProvider(provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Unknown scrobbler provider") from exc


async def _get_connection(
    db: AsyncSession, user_id: int, provider: ScrobblerProvider
) -> ScrobblerConnection | None:
    result = await db.execute(
        select(ScrobblerConnection).where(
            ScrobblerConnection.user_id == user_id,
            ScrobblerConnection.provider == provider,
        )
    )
    return result.scalar_one_or_none()


@router.get("/providers", response_model=list[ScrobblerProviderInfo])
async def list_providers() -> list[ScrobblerProviderInfo]:
    return [ScrobblerProviderInfo(id=provider.id, name=provider.name) for provider in list_configured_providers()]


@router.get("/{provider_id}", response_model=ScrobblerConnectionStatus)
async def get_status(
    provider_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScrobblerConnectionStatus:
    provider = _parse_provider(provider_id)
    config = get_provider(provider.value)
    connection = await _get_connection(db, current_user.id, provider)
    return ScrobblerConnectionStatus(
        provider=provider.value,
        configured=bool(config and config.configured),
        linked=connection is not None,
        username=connection.username if connection else None,
        scrobbling_enabled=connection.scrobbling_enabled if connection else False,
        linked_at=connection.linked_at if connection else None,
    )


@router.post("/{provider_id}/link/start", response_model=ScrobblerLinkStart)
async def start_link(provider_id: str, current_user: User = Depends(get_current_user)) -> ScrobblerLinkStart:
    provider = _parse_provider(provider_id)
    config = get_provider(provider.value)
    if not config or not config.configured:
        raise HTTPException(status_code=503, detail=f"{provider.value} is not configured on this server")

    try:
        token = await audioscrobbler_client.get_auth_token(config)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    return ScrobblerLinkStart(
        token=token,
        authorize_url=audioscrobbler_client.build_authorize_url(config, token),
    )


@router.post("/{provider_id}/link/complete", response_model=ScrobblerConnectionRead)
async def complete_link(
    provider_id: str,
    payload: ScrobblerLinkComplete,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScrobblerConnectionRead:
    provider = _parse_provider(provider_id)
    config = get_provider(provider.value)
    if not config or not config.configured:
        raise HTTPException(status_code=503, detail=f"{provider.value} is not configured on this server")

    try:
        username, session_key = await audioscrobbler_client.get_session(config, payload.token)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    connection = await _get_connection(db, current_user.id, provider)
    if connection is None:
        connection = ScrobblerConnection(
            user_id=current_user.id,
            provider=provider,
            username=username,
            session_key=session_key,
            scrobbling_enabled=True,
        )
        db.add(connection)
    else:
        connection.username = username
        connection.session_key = session_key
        connection.scrobbling_enabled = True

    await db.commit()
    await db.refresh(connection)
    return ScrobblerConnectionRead.model_validate(connection, from_attributes=True)


@router.patch("/{provider_id}", response_model=ScrobblerConnectionRead)
async def update_settings(
    provider_id: str,
    payload: ScrobblerSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ScrobblerConnectionRead:
    provider = _parse_provider(provider_id)
    connection = await _get_connection(db, current_user.id, provider)
    if connection is None:
        raise HTTPException(status_code=404, detail="No linked scrobbler account for this user")

    connection.scrobbling_enabled = payload.scrobbling_enabled
    await db.commit()
    await db.refresh(connection)
    return ScrobblerConnectionRead.model_validate(connection, from_attributes=True)


@router.delete("/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink(
    provider_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    provider = _parse_provider(provider_id)
    connection = await _get_connection(db, current_user.id, provider)
    if connection is None:
        raise HTTPException(status_code=404, detail="No linked scrobbler account for this user")

    await db.delete(connection)
    await db.commit()


async def scrobble_play_for_user(
    user_id: int,
    *,
    title: str,
    artist: str | None,
    duration_sec: int | None,
    listened_sec: int | None,
) -> None:
    if not should_scrobble(listened_sec, duration_sec):
        return

    async with SessionLocal() as db:
        result = await db.execute(
            select(ScrobblerConnection).where(
                ScrobblerConnection.user_id == user_id,
                ScrobblerConnection.scrobbling_enabled.is_(True),
            )
        )
        connections = result.scalars().all()
        if not connections:
            return

        track_artist, track_title = normalize_track_metadata(title, artist)
        for connection in connections:
            config = get_provider(connection.provider.value)
            if not config or not config.configured:
                continue
            try:
                await audioscrobbler_client.scrobble(
                    config,
                    session_key=connection.session_key,
                    artist=track_artist,
                    track=track_title,
                    duration_sec=duration_sec,
                )
            except Exception:
                logger.exception(
                    "Failed to scrobble for user %s via %s",
                    user_id,
                    connection.provider.value,
                )


def schedule_scrobble(
    user_id: int,
    *,
    title: str,
    artist: str | None,
    duration_sec: int | None,
    listened_sec: int | None,
) -> None:
    asyncio.create_task(
        scrobble_play_for_user(
            user_id,
            title=title,
            artist=artist,
            duration_sec=duration_sec,
            listened_sec=listened_sec,
        )
    )
