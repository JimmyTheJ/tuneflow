import re

HOUSEHOLD_SLUG_PATTERN = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
RESERVED_HOUSEHOLD_SLUGS = frozenset({"system", "api", "login", "setup", "admin", "auth", "h"})


def normalize_household_slug(value: str) -> str:
    return value.strip().lower()


def slugify_household_name(name: str) -> str:
    slug = name.strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "household"


_INVALID_FILENAME_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_MAX_TRACK_FILENAME_LEN = 180


def sanitize_filename_part(value: str) -> str:
    cleaned = _INVALID_FILENAME_CHARS.sub("", value.strip())
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip(". ")


def build_track_filename(
    title: str,
    *,
    artist: str | None = None,
    position: int | None = None,
    suffix: str = ".m4a",
) -> str:
    parts: list[str] = []
    if position is not None:
        parts.append(f"{position:02d}")
    if artist:
        artist_part = sanitize_filename_part(artist)
        if artist_part:
            parts.append(artist_part)
    title_part = sanitize_filename_part(title) or "track"
    parts.append(title_part)

    base = " - ".join(parts)
    if len(base) > _MAX_TRACK_FILENAME_LEN:
        base = base[:_MAX_TRACK_FILENAME_LEN].rstrip(". ")
    return f"{base}{suffix}"


def validate_household_slug(slug: str) -> str:
    normalized = normalize_household_slug(slug)
    if len(normalized) < 2 or len(normalized) > 80:
        raise ValueError("Household slug must be 2-80 characters")
    if not HOUSEHOLD_SLUG_PATTERN.match(normalized):
        raise ValueError("Household slug may only contain lowercase letters, numbers, and hyphens")
    if normalized in RESERVED_HOUSEHOLD_SLUGS:
        raise ValueError("That household slug is reserved")
    return normalized
