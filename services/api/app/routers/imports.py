from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import ImportJob, ImportJobProvider, ImportJobStatus, PlaylistVisibility, User
from app.schemas import ImportJobCreate, ImportJobRead, ImportProvidersStatus
from app.services.import_jobs import get_owned_job, schedule_import_job
from app.services.spotify import parse_spotify_playlist_id, spotify_configured
from app.services.youtube_playlist import parse_youtube_playlist_id

router = APIRouter(prefix="/imports", tags=["imports"])


def _job_read(job: ImportJob) -> ImportJobRead:
    return ImportJobRead(
        id=job.id,
        provider=job.provider.value if hasattr(job.provider, "value") else str(job.provider),
        status=job.status.value if hasattr(job.status, "value") else str(job.status),
        source_url=job.source_url,
        source_external_id=job.source_external_id,
        requested_name=job.requested_name,
        visibility=job.visibility.value if hasattr(job.visibility, "value") else str(job.visibility),
        progress_done=job.progress_done,
        progress_total=job.progress_total,
        message=job.message,
        error=job.error,
        result_playlist_id=job.result_playlist_id,
        created_at=job.created_at,
        updated_at=job.updated_at,
        finished_at=job.finished_at,
    )


@router.get("/providers", response_model=ImportProvidersStatus)
async def list_import_providers() -> ImportProvidersStatus:
    return ImportProvidersStatus(youtube=True, spotify=spotify_configured())


@router.get("", response_model=list[ImportJobRead])
async def list_import_jobs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[ImportJobRead]:
    result = await db.execute(
        select(ImportJob)
        .where(ImportJob.user_id == current_user.id)
        .order_by(ImportJob.created_at.desc())
        .limit(20)
    )
    return [_job_read(job) for job in result.scalars().all()]


@router.post("", response_model=ImportJobRead, status_code=status.HTTP_201_CREATED)
async def create_import_job(
    payload: ImportJobCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ImportJobRead:
    provider = ImportJobProvider(payload.provider)
    visibility = PlaylistVisibility(payload.visibility)

    if provider == ImportJobProvider.spotify and not spotify_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Spotify import is not configured on this server",
        )

    external_id: str | None = None
    if provider == ImportJobProvider.youtube:
        external_id = parse_youtube_playlist_id(payload.url)
        if not external_id:
            raise HTTPException(status_code=400, detail="Could not parse YouTube playlist URL")
    elif provider == ImportJobProvider.spotify:
        external_id = parse_spotify_playlist_id(payload.url)
        if not external_id:
            raise HTTPException(status_code=400, detail="Could not parse Spotify playlist URL")

    job = ImportJob(
        user_id=current_user.id,
        provider=provider,
        status=ImportJobStatus.queued,
        source_url=payload.url.strip(),
        source_external_id=external_id,
        requested_name=payload.name.strip() if payload.name else None,
        visibility=visibility,
        message="Queued",
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    schedule_import_job(job.id)
    return _job_read(job)


@router.get("/{job_id}", response_model=ImportJobRead)
async def get_import_job(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ImportJobRead:
    job = await get_owned_job(db, job_id, current_user.id)
    if job is None:
        raise HTTPException(status_code=404, detail="Import job not found")
    return _job_read(job)
