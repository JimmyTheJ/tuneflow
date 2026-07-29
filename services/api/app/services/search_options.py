"""Search option resolution, pagination cursors, grouping, and explain mode."""

from __future__ import annotations

import base64
import json
import re
from typing import Any

from pydantic import BaseModel, Field

from app.models import Household, ParentalSettings
from app.schemas import SearchExplanation, SearchOptions, SearchResult, SearchResultGroup

_FAN_UPLOAD_RE = re.compile(
    r"\b(cover|karaoke|tribute|nursery rhymes|wake up|reaction|reacts? to)\b",
    re.IGNORECASE,
)
_LOOP_RE = re.compile(
    r"\b(loop|hour|hours|straight|compilation|full album|mixtape|megamix)\b",
    re.IGNORECASE,
)

PRODUCT_DEFAULTS = SearchOptions()


def parse_household_search_defaults(household: Household | None) -> SearchOptions:
    if household is None or not household.search_defaults_json:
        return SearchOptions()
    try:
        payload = json.loads(household.search_defaults_json)
        if isinstance(payload, dict):
            return SearchOptions.model_validate(payload)
    except (json.JSONDecodeError, ValueError):
        pass
    return SearchOptions()


def merge_search_options(base: SearchOptions, override: SearchOptions | None) -> SearchOptions:
    if override is None:
        return base.model_copy()
    data = base.model_dump()
    for key, value in override.model_dump(exclude_unset=True).items():
        data[key] = value
    return SearchOptions.model_validate(data)


def resolve_search_options(
    *,
    household: Household | None,
    parental: ParentalSettings | None,
    requested: SearchOptions | None,
    allow_session_override: bool = True,
) -> SearchOptions:
    effective = parse_household_search_defaults(household)

    if parental is not None:
        if parental.search_force_clean:
            effective = merge_search_options(
                effective,
                SearchOptions(hide_covers=True, hide_loops=True),
            )

    allow_override = allow_session_override
    if parental is not None and (parental.search_locked or parental.search_advanced_hidden):
        allow_override = False

    if allow_override and requested is not None:
        effective = merge_search_options(effective, requested)

    if parental is not None and parental.search_max_versions_ceiling is not None:
        ceiling = parental.search_max_versions_ceiling
        if effective.max_per_song is None or effective.max_per_song > ceiling:
            effective = merge_search_options(effective, SearchOptions(max_per_song=ceiling))

    return effective


def should_hide_result(result: SearchResult, *, options: SearchOptions) -> bool:
    display = (result.source_title or result.title or "").strip()
    if options.hide_covers and _FAN_UPLOAD_RE.search(display):
        return True
    if options.hide_loops and _LOOP_RE.search(display):
        return True
    return False


def filter_search_results(
    results: list[SearchResult],
    *,
    options: SearchOptions,
) -> tuple[list[SearchResult], int]:
    if not options.hide_covers and not options.hide_loops:
        return results, 0
    kept: list[SearchResult] = []
    removed = 0
    for result in results:
        if should_hide_result(result, options=options):
            removed += 1
            continue
        kept.append(result)
    return kept, removed


def group_search_results(
    results: list[SearchResult],
    *,
    max_per_song: int | None,
    song_key_fn,
) -> list[SearchResultGroup]:
    if max_per_song == 1:
        return [
            SearchResultGroup(
                group_key=song_key_fn(result) or result.video_id,
                primary=result,
                alternates=[],
            )
            for result in results
        ]

    groups: dict[str, SearchResultGroup] = {}
    order: list[str] = []
    for result in results:
        key = song_key_fn(result) or result.video_id
        existing = groups.get(key)
        if existing is None:
            groups[key] = SearchResultGroup(group_key=key, primary=result, alternates=[])
            order.append(key)
        else:
            existing.alternates.append(result)
    return [groups[key] for key in order]


def build_search_explanation(
    *,
    options: SearchOptions,
    household: Household | None,
    parental: ParentalSettings | None,
    filtered_count: int,
    collapsed_count: int,
) -> SearchExplanation | None:
    messages: list[str] = []
    household_defaults = parse_household_search_defaults(household)

    if options.max_per_song is None:
        messages.append("Showing all versions per song")
    elif options.max_per_song > 1:
        messages.append(f"Up to {options.max_per_song} versions per song")
    elif options.max_per_song == 1:
        if household_defaults.max_per_song not in (None, 1):
            messages.append("Collapsed to 1 version per song")

    if options.hide_covers:
        messages.append("Covers and karaoke hidden")
    if options.hide_loops:
        messages.append("Long mixes and loops hidden")
    if filtered_count:
        messages.append(f"Filtered {filtered_count} result{'s' if filtered_count != 1 else ''}")
    if collapsed_count:
        messages.append(
            f"Collapsed {collapsed_count} duplicate upload{'s' if collapsed_count != 1 else ''}"
        )

    if parental is not None:
        if parental.search_locked:
            messages.append("Search options locked by parental controls")
        elif parental.search_advanced_hidden:
            messages.append("Using household search defaults")

    if not messages:
        return None
    return SearchExplanation(messages=messages)


class SearchCursor(BaseModel):
    piped_nextpage: str | None = None
    seen_video_ids: list[str] = Field(default_factory=list)
    song_counts: dict[str, int] = Field(default_factory=dict)
    options_fingerprint: str = ""


def options_fingerprint(options: SearchOptions) -> str:
    return json.dumps(options.model_dump(mode="json"), sort_keys=True)


def encode_search_cursor(cursor: SearchCursor) -> str | None:
    if cursor.piped_nextpage is None:
        return None
    payload = cursor.model_dump()
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_search_cursor(token: str | None, *, expected_fingerprint: str) -> SearchCursor | None:
    if not token:
        return None
    try:
        padding = "=" * (-len(token) % 4)
        raw = base64.urlsafe_b64decode(token + padding)
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            return None
        cursor = SearchCursor.model_validate(payload)
    except (ValueError, json.JSONDecodeError):
        return None
    if cursor.options_fingerprint != expected_fingerprint:
        return None
    return cursor


def max_per_song_from_query(value: int | None) -> int | None:
    """Query param: omit = unset, 0 = unlimited, positive = cap."""
    if value is None:
        return None
    if value <= 0:
        return None
    return value
