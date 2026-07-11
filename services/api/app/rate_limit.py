import asyncio
import time
from collections import defaultdict

from fastapi import HTTPException, Request, status

from app.config import settings


class RateLimiter:
    def __init__(self) -> None:
        self._events: dict[str, list[float]] = defaultdict(list)
        self._lock = asyncio.Lock()

    async def _prune(self, key: str, window_sec: int, now: float) -> list[float]:
        cutoff = now - window_sec
        events = [timestamp for timestamp in self._events[key] if timestamp > cutoff]
        if events:
            self._events[key] = events
        else:
            self._events.pop(key, None)
        return events

    async def is_locked(self, key: str, limit: int, window_sec: int) -> tuple[bool, int]:
        now = time.monotonic()
        async with self._lock:
            events = await self._prune(key, window_sec, now)
            if len(events) < limit:
                return False, 0
            retry_after = int(events[0] + window_sec - now) + 1
            return True, max(1, retry_after)

    async def record_failure(self, key: str, limit: int, window_sec: int) -> None:
        now = time.monotonic()
        async with self._lock:
            events = await self._prune(key, window_sec, now)
            events.append(now)
            self._events[key] = events

    async def record_attempt(self, key: str, limit: int, window_sec: int) -> tuple[bool, int]:
        now = time.monotonic()
        async with self._lock:
            events = await self._prune(key, window_sec, now)
            if len(events) >= limit:
                retry_after = int(events[0] + window_sec - now) + 1
                return False, max(1, retry_after)
            events.append(now)
            self._events[key] = events
            return True, 0

    async def clear(self, key: str) -> None:
        async with self._lock:
            self._events.pop(key, None)


limiter = RateLimiter()


def get_client_ip(request: Request) -> str:
    if settings.trust_proxy_headers:
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip.strip()
    if request.client:
        return request.client.host
    return "unknown"


async def enforce_not_locked(keys: list[str], *, limit: int, window_sec: int) -> None:
    if not settings.rate_limit_enabled:
        return
    for key in keys:
        locked, retry_after = await limiter.is_locked(key, limit, window_sec)
        if locked:
            minutes = max(1, (retry_after + 59) // 60)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many attempts. Try again in about {minutes} minute(s).",
                headers={"Retry-After": str(retry_after)},
            )


async def record_failures(keys: list[str], *, limit: int, window_sec: int) -> None:
    if not settings.rate_limit_enabled:
        return
    for key in keys:
        await limiter.record_failure(key, limit, window_sec)


async def enforce_attempt_budget(key: str, *, limit: int, window_sec: int) -> None:
    if not settings.rate_limit_enabled:
        return
    allowed, retry_after = await limiter.record_attempt(key, limit, window_sec)
    if not allowed:
        minutes = max(1, (retry_after + 59) // 60)
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many attempts. Try again in about {minutes} minute(s).",
            headers={"Retry-After": str(retry_after)},
        )
