from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import PlayHistory, User
from app.schemas import AiInsights, AiRecommendations, LlmStatus
from app.services.llm import llm_client

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/status", response_model=LlmStatus)
async def ai_status(_: User = Depends(get_current_user)) -> LlmStatus:
    return await llm_client.status()


@router.get("/insights", response_model=AiInsights)
async def listening_insights(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AiInsights:
    _ensure_llm_ready()
    history_lines = await _history_lines(db, current_user.id)
    try:
        return await llm_client.insights(history_lines, current_user.display_name)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


@router.get("/recommendations", response_model=AiRecommendations)
async def music_recommendations(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AiRecommendations:
    _ensure_llm_ready()
    history_lines = await _history_lines(db, current_user.id)
    try:
        return await llm_client.recommendations(history_lines, current_user.display_name)
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc


def _ensure_llm_ready() -> None:
    if not settings.llm_enabled:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="LLM is disabled on this server")


async def _history_lines(db: AsyncSession, user_id: int) -> list[str]:
    result = await db.execute(
        select(PlayHistory)
        .where(PlayHistory.user_id == user_id)
        .order_by(PlayHistory.played_at.desc())
        .limit(40)
    )
    lines: list[str] = []
    for row in result.scalars().all():
        artist = row.artist or "Unknown artist"
        lines.append(f"{row.title} by {artist}")
    return lines
