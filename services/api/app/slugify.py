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


def validate_household_slug(slug: str) -> str:
    normalized = normalize_household_slug(slug)
    if len(normalized) < 2 or len(normalized) > 80:
        raise ValueError("Household slug must be 2-80 characters")
    if not HOUSEHOLD_SLUG_PATTERN.match(normalized):
        raise ValueError("Household slug may only contain lowercase letters, numbers, and hyphens")
    if normalized in RESERVED_HOUSEHOLD_SLUGS:
        raise ValueError("That household slug is reserved")
    return normalized
