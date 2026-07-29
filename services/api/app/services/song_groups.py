"""Group search results by song and elect the canonical version as primary.

Piped's music_songs feed gives us only a title, an uploader (name + channel id)
and a duration. Covers rarely say "cover" anywhere, and live album tracks carry
clean titles, so title text alone cannot tell the studio original from a cover
or a live take. This module combines three signals instead:

1. canonical artist identity, from MusicBrainz plus the channel that serves the
   artist's own uploads in this result set;
2. agreement with the canonical release duration;
3. duration consensus among the uploads of the same song.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.schemas import SearchResult, SearchResultGroup
from app.services.piped import (
    normalize_text,
    result_candidate_artist,
    song_title_key,
    version_marker_label,
    version_marker_penalty,
)

# Two uploads of one recording rarely differ by more than this, while covers and
# alternate takes usually do.
_DURATION_TOLERANCE = 0.06


@dataclass
class SongIdentity:
    """Canonical facts about one song title, used to key groups and rank versions."""

    artist_name: str | None = None
    artist_channel_ids: set[str] = field(default_factory=set)
    duration_sec: int | None = None
    recording_mbid: str | None = None

    @property
    def is_attributed(self) -> bool:
        return bool(self.artist_name)


def _durations_agree(left: int | None, right: int | None) -> bool:
    if not left or not right:
        return False
    return abs(left - right) / max(left, right) <= _DURATION_TOLERANCE


def consensus_duration(durations: list[int]) -> int | None:
    """Centre of the largest cluster of similar durations.

    Multiple uploads of the same recording cluster tightly; covers and alternate
    takes scatter. The largest cluster is therefore the actual recording.
    """
    known = sorted(d for d in durations if d)
    if not known:
        return None
    best: list[int] = []
    for anchor in known:
        cluster = [d for d in known if _durations_agree(anchor, d)]
        if len(cluster) > len(best):
            best = cluster
    if len(best) < 2:
        return None
    return best[len(best) // 2]


def _credit_parts(artist_name: str) -> list[str]:
    """Normalized names in an artist credit, which may list collaborators."""
    parts = [normalize_text(part) for part in artist_name.replace("&", ",").split(",")]
    return [part for part in parts if len(part) >= 3]


def artist_name_matches(uploader: str | None, artist_name: str | None) -> bool:
    if not uploader or not artist_name:
        return False
    upload_key = normalize_text(uploader)
    if not upload_key:
        return False
    if upload_key == normalize_text(artist_name):
        return True
    return any(part == upload_key for part in _credit_parts(artist_name))


def artist_channel_ids(results: list[SearchResult], artist_name: str) -> set[str]:
    """Channel ids that upload under the canonical artist's own name.

    music_songs reports the performing artist as the uploader, so a name match
    identifies the artist's official channel without an extra lookup.
    """
    if not normalize_text(artist_name):
        return set()
    return {
        result.channel_id
        for result in results
        if result.channel_id and artist_name_matches(result.artist, artist_name)
    }


def _is_canonical_artist(result: SearchResult, identity: SongIdentity) -> bool:
    if result.channel_id and result.channel_id in identity.artist_channel_ids:
        return True
    return artist_name_matches(result.artist, identity.artist_name)


def group_key_for(result: SearchResult, identity: SongIdentity | None) -> str:
    """Key a result to its song.

    Merging every upload of a title only makes sense once we know which artist
    the title belongs to; otherwise same-titled but unrelated songs (Adele's
    "Hello" and Lionel Richie's) would collapse together, so we keep the
    artist in the key.
    """
    title_key = song_title_key(result)
    if not title_key:
        return result.video_id
    if identity is not None and identity.is_attributed:
        return f"song:{title_key}"
    artist_key = normalize_text(result_candidate_artist(result))
    if not artist_key:
        return result.video_id
    return f"{artist_key}|{title_key}"


def version_rank(
    result: SearchResult,
    *,
    identity: SongIdentity,
    consensus_sec: int | None,
    original_index: int,
) -> tuple[int, int, int, int, int]:
    """Ascending sort key electing the studio original by the canonical artist."""
    by_canonical_artist = 0 if _is_canonical_artist(result, identity) else 1
    matches_canonical_duration = (
        0 if _durations_agree(result.duration_sec, identity.duration_sec) else 1
    )
    matches_consensus = 0 if _durations_agree(result.duration_sec, consensus_sec) else 1
    return (
        by_canonical_artist,
        matches_canonical_duration,
        matches_consensus,
        version_marker_penalty(result),
        original_index,
    )


def describe_version(result: SearchResult, *, identity: SongIdentity, is_primary: bool) -> str | None:
    """Short label explaining how a version differs from the primary."""
    marker = version_marker_label(result)
    if marker:
        return marker
    if is_primary:
        return None
    if identity.is_attributed and not _is_canonical_artist(result, identity):
        return "Cover"
    if identity.duration_sec and not _durations_agree(result.duration_sec, identity.duration_sec):
        return "Alt version"
    return None


def identity_for_song(
    *,
    canonical_artist: str | None,
    canonical_duration_sec: int | None,
    recording_mbid: str | None,
    candidates: list[SearchResult],
) -> SongIdentity:
    """Bind canonical facts about a song to the channels serving it here."""
    if not canonical_artist:
        return SongIdentity()
    return SongIdentity(
        artist_name=canonical_artist,
        artist_channel_ids=artist_channel_ids(candidates, canonical_artist),
        duration_sec=canonical_duration_sec,
        recording_mbid=recording_mbid,
    )


def candidate_titles_by_key(results: list[SearchResult]) -> dict[str, str]:
    """Map each song key to a readable title, most frequent spelling winning."""
    counts: dict[str, dict[str, int]] = {}
    for result in results:
        key = song_title_key(result)
        if not key:
            continue
        spellings = counts.setdefault(key, {})
        title = (result.title or "").strip()
        if title:
            spellings[title] = spellings.get(title, 0) + 1
    return {
        key: max(spellings.items(), key=lambda item: item[1])[0]
        for key, spellings in counts.items()
        if spellings
    }


def _labelled(result: SearchResult, label: str | None) -> SearchResult:
    if label == result.version_label:
        return result
    return result.model_copy(update={"version_label": label})


def build_song_groups(
    results: list[SearchResult],
    *,
    max_per_song: int | None,
    identities: dict[str, SongIdentity],
    skip_group_keys: set[str] | None = None,
) -> tuple[list[SearchResultGroup], int]:
    """Assemble one group per song, most relevant song first.

    Returns the groups plus the number of versions withheld by ``max_per_song``.
    """
    skip = skip_group_keys or set()
    order: list[str] = []
    members: dict[str, list[SearchResult]] = {}
    group_identities: dict[str, SongIdentity] = {}

    for result in results:
        title_key = song_title_key(result)
        identity = identities.get(title_key) if title_key else None
        key = group_key_for(result, identity)
        if key in skip:
            continue
        if key not in members:
            members[key] = []
            order.append(key)
            group_identities[key] = identity or SongIdentity()
        members[key].append(result)

    groups: list[SearchResultGroup] = []
    collapsed = 0
    for key in order:
        candidates = members[key]
        identity = group_identities[key]
        consensus_sec = consensus_duration([c.duration_sec for c in candidates if c.duration_sec])
        ranked = [
            candidate
            for _, candidate in sorted(
                enumerate(candidates),
                key=lambda pair: version_rank(
                    pair[1],
                    identity=identity,
                    consensus_sec=consensus_sec,
                    original_index=pair[0],
                ),
            )
        ]
        primary = _labelled(ranked[0], describe_version(ranked[0], identity=identity, is_primary=True))
        alternates = [
            _labelled(candidate, describe_version(candidate, identity=identity, is_primary=False))
            for candidate in ranked[1:]
        ]
        total_versions = len(candidates)
        if max_per_song is not None:
            allowed = max(0, max_per_song - 1)
            collapsed += max(0, len(alternates) - allowed)
            alternates = alternates[:allowed]
        groups.append(
            SearchResultGroup(
                group_key=key,
                primary=primary,
                alternates=alternates,
                total_versions=total_versions,
            )
        )
    return groups, collapsed
