import asyncio
import random
from collections.abc import Awaitable, Callable
from typing import TypeVar

import httpx

T = TypeVar("T")

TRANSIENT_STATUS_CODES = frozenset({408, 429, 502, 503, 504})


def is_transient_http_error(exc: BaseException) -> bool:
    if isinstance(exc, httpx.TimeoutException):
        return True
    if isinstance(exc, httpx.ConnectError):
        return True
    if isinstance(exc, httpx.NetworkError):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in TRANSIENT_STATUS_CODES
    if isinstance(exc, httpx.HTTPError):
        return True
    return False


def is_transient_ytdlp_failure(exc: BaseException) -> bool:
    if isinstance(exc, ValueError):
        return False
    return True


async def with_retry(
    fn: Callable[[], Awaitable[T]],
    *,
    max_attempts: int = 3,
    base_delay: float = 0.5,
    max_delay: float = 4.0,
    should_retry: Callable[[BaseException], bool] | None = None,
) -> T:
    retry_check = should_retry or is_transient_http_error
    last_exc: BaseException | None = None

    for attempt in range(1, max_attempts + 1):
        try:
            return await fn()
        except BaseException as exc:
            last_exc = exc
            if attempt >= max_attempts or not retry_check(exc):
                raise
            delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
            delay += delay * 0.2 * random.random()
            await asyncio.sleep(delay)

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("with_retry exhausted without result")
