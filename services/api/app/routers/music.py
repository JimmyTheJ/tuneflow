import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth import verify_token
from app.schemas import SearchResult, StreamInfo
from app.services.piped import piped_client

router = APIRouter(prefix="/music", tags=["music"], dependencies=[Depends(verify_token)])


def _piped_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=502,
        detail="Music source unreachable. Check PIPED_BASE_URL or start the piped compose profile.",
    ) from exc


@router.get("/search", response_model=list[SearchResult])
async def search_music(q: str = Query(min_length=1), limit: int = Query(default=20, ge=1, le=50)) -> list[SearchResult]:
    try:
        return await piped_client.search(q, limit=limit)
    except httpx.HTTPError as exc:
        raise _piped_unavailable(exc) from exc


@router.get("/stream/{video_id}", response_model=StreamInfo)
async def get_stream(video_id: str) -> StreamInfo:
    try:
        return await piped_client.get_stream(video_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except httpx.HTTPError as exc:
        raise _piped_unavailable(exc) from exc
