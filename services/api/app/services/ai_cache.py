"""Persistent cache for AI discover endpoints (insights + recommendations)."""

from __future__ import annotations

from app.services.catalog_cache import get_catalog_cache, set_catalog_cache


def discover_insights_key(user_id: int) -> str:
    return f"discover:insights:{user_id}"


def discover_recommendations_key(user_id: int) -> str:
    return f"discover:recommendations:{user_id}"


async def get_discover_insights(user_id: int) -> str | None:
    return await get_catalog_cache(discover_insights_key(user_id))


async def set_discover_insights(user_id: int, payload_json: str) -> None:
    await set_catalog_cache(discover_insights_key(user_id), payload_json)


async def get_discover_recommendations(user_id: int) -> str | None:
    return await get_catalog_cache(discover_recommendations_key(user_id))


async def set_discover_recommendations(user_id: int, payload_json: str) -> None:
    await set_catalog_cache(discover_recommendations_key(user_id), payload_json)
