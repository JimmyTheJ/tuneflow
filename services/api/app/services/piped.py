import re

import httpx

from app.config import settings
from app.retry import is_transient_http_error, with_retry
from app.schemas import SearchResult, StreamInfo
from app.services.thumbnails import youtube_thumbnail_url

_ARTIST_TITLE_RE = re.compile(
    r"^(?P<artist>.+?)\s*[-–—|:]\s*(?P<title>.+?)(?:\s*[\(\[].*[\)\]])?$"
)
_LIVE_QUERY_RE = re.compile(r"\blive\b", re.IGNORECASE)
# Prefer markers that mean "live performance", not song titles like "Live and Let Die".
_LIVE_VERSION_RE = re.compile(
    r"("
    r"\blive\s+(at|from|in|on)\b|"
    r"[\(\[][^)\]]*\blive\b[^)\]]*[)\]]|"
    r"[-–—|:]\s*live\b|"
    r"\blive\s*(version|recording|performance|session)\b|"
    r"\bunplugged\b"
    r")",
    re.IGNORECASE,
)


def parse_artist_title(raw_title: str) -> tuple[str | None, str]:
    match = _ARTIST_TITLE_RE.match(raw_title.strip())
    if not match:
        return None, raw_title.strip()
    return match.group("artist").strip(), match.group("title").strip()


def _normalize_text(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _title_tokens(value: str) -> list[str]:
    cleaned = re.sub(r"[\(\[].*?[\)\]]", "", value, flags=re.IGNORECASE)
    return [token for token in re.split(r"[^a-z0-9]+", cleaned.lower()) if token]


def title_matches(wanted: str, candidate: str) -> bool:
    wanted_tokens = _title_tokens(wanted)
    candidate_tokens = _title_tokens(candidate)
    if not wanted_tokens or not candidate_tokens:
        left = _normalize_text(wanted)
        right = _normalize_text(candidate)
        return bool(left and right and left == right)
    if wanted_tokens == candidate_tokens:
        return True

    shorter, longer = (
        (wanted_tokens, candidate_tokens)
        if len(wanted_tokens) <= len(candidate_tokens)
        else (candidate_tokens, wanted_tokens)
    )
    if longer[: len(shorter)] == shorter:
        return True
    if longer[-len(shorter) :] == shorter:
        return len(shorter) / len(longer) >= 0.85
    if len(shorter) == 1:
        token = shorter[0]
        return any(
            token == longer_token
            or (token in longer_token and len(token) >= max(5, int(len(longer_token) * 0.75)))
            for longer_token in longer
        )
    return False


def artist_matches(wanted: str | None, candidate: str | None) -> bool:
    if not wanted:
        return True
    if not candidate:
        return False
    left = _normalize_text(wanted.replace("- Topic", ""))
    right = _normalize_text(candidate.replace("- Topic", ""))
    return bool(left and right and (left in right or right in left))


def matches_requested_track(
    *,
    wanted_title: str,
    wanted_artist: str | None,
    candidate_title: str,
    candidate_artist: str | None,
) -> bool:
    if not title_matches(wanted_title, candidate_title):
        return False
    if not wanted_artist:
        return True
    if artist_matches(wanted_artist, candidate_artist):
        return True
    if is_topic_upload(wanted_artist):
        topic_artist = wanted_artist.replace("- Topic", "").strip()
        combined = f"{candidate_title} {candidate_artist or ''}"
        return _normalize_text(topic_artist) in _normalize_text(combined)
    combined = f"{candidate_title} {candidate_artist or ''}"
    return _normalize_text(wanted_artist.replace("- Topic", "").strip()) in _normalize_text(combined)


def is_topic_upload(artist: str | None) -> bool:
    return bool(artist and artist.rstrip().endswith("- Topic"))


def query_requests_live(query: str | None) -> bool:
    return bool(query and _LIVE_QUERY_RE.search(query))


def looks_like_live_version(*parts: str | None) -> bool:
    text = " ".join(part for part in parts if part)
    return bool(text and _LIVE_VERSION_RE.search(text))


_LOOP_RE = re.compile(
    r"\b(loop|hour|hours|straight|compilation|full album|mixtape|megamix)\b",
    re.IGNORECASE,
)
_FAN_UPLOAD_RE = re.compile(
    r"\b(cover|karaoke|tribute|nursery rhymes|wake up|reaction|reacts? to)\b",
    re.IGNORECASE,
)
_OFFICIAL_AUDIO_RE = re.compile(r"\bofficial\s+audio\b", re.IGNORECASE)
_OFFICIAL_RE = re.compile(r"\bofficial\b", re.IGNORECASE)
_ALT_RECORDING_RE = re.compile(
    r"\b(concert|broadway|in concert|anniversary|remix|acoustic|unplugged|on broadway)\b",
    re.IGNORECASE,
)
_ANIMATED_RE = re.compile(r"\b(animated|animation)\b", re.IGNORECASE)


def studio_quality_score(
    result: SearchResult,
    *,
    wanted_title: str,
    wanted_artist: str,
    wanted_duration_ms: int | None = None,
) -> int:
    """Higher is better. Prefer Topic/official studio uploads over fan re-uploads."""
    display = _result_display_title(result)
    score = 0

    if is_topic_upload(result.artist):
        score += 6
    if _OFFICIAL_AUDIO_RE.search(display):
        score += 5
    elif _OFFICIAL_RE.search(display):
        score += 3

    parsed_artist, parsed_title = parse_artist_title(display)
    if artist_matches(wanted_artist, parsed_artist or result.artist):
        score += 1
    if title_matches(wanted_title, parsed_title or result.title):
        score += 1

    if _result_is_live(result):
        score -= 4
    if _ALT_RECORDING_RE.search(display):
        score -= 3
    if _LOOP_RE.search(display):
        score -= 6
    if _FAN_UPLOAD_RE.search(display):
        score -= 5
    if _ANIMATED_RE.search(display):
        score -= 1

    if wanted_duration_ms and result.duration_sec:
        wanted_sec = wanted_duration_ms / 1000
        if result.duration_sec > wanted_sec * 2.5:
            score -= 6
        elif result.duration_sec > wanted_sec * 1.8:
            score -= 3
        elif result.duration_sec < wanted_sec * 0.5:
            score -= 4

    return score


def _result_display_title(result: SearchResult) -> str:
    return (result.source_title or result.title or "").strip()


def _parsed_source_parts(result: SearchResult) -> tuple[str | None, str]:
    """Split "Artist - Title" only when that reading agrees with the result title.

    yt-dlp stubs put the whole "Artist - Title" string in source_title and the
    remainder in title, so the split is meaningful. Piped music_songs entries
    put a bare song title in both and the artist in the uploader field, where
    splitting would mangle titles like "Up On the House-Top" or "Medley: ...".
    """
    display = _result_display_title(result)
    parsed_artist, parsed_title = parse_artist_title(display)
    own_title = (result.title or "").strip()
    if parsed_artist and own_title and _normalize_text(parsed_title) == _normalize_text(own_title):
        return parsed_artist, parsed_title
    return None, own_title or display


def _result_candidate_title(result: SearchResult) -> str:
    _, title = _parsed_source_parts(result)
    return title


def _result_candidate_artist(result: SearchResult) -> str:
    parsed_artist, _ = _parsed_source_parts(result)
    return (parsed_artist or result.artist or "").replace("- Topic", "").strip()


def _token_in_text(token: str, text: str) -> bool:
    if not text:
        return False
    norm_token = _normalize_text(token)
    if not norm_token:
        return False
    if norm_token in _normalize_text(text):
        return True
    return title_matches(token, text)


def query_relevance_score(query: str, result: SearchResult) -> int:
    """Higher is better. Score how well a search result matches the user query."""
    query = query.strip()
    if not query:
        return 0

    title = _result_candidate_title(result)
    artist = _result_candidate_artist(result)
    query_tokens = _title_tokens(query)
    if not query_tokens:
        return 0

    score = 0
    combined = f"{title} {artist}".strip()
    norm_query = _normalize_text(query)
    norm_combined = _normalize_text(combined)

    if norm_query and norm_query in norm_combined:
        score += 6

    if title_matches(query, title):
        score += 8
    elif title and any(_token_in_text(token, title) for token in query_tokens):
        score += 4

    if artist:
        if artist_matches(query, artist):
            score += 4
        elif any(len(token) >= 3 and artist_matches(token, artist) for token in query_tokens):
            score += 3

    if len(query_tokens) >= 2 and title and artist:
        for split_at in range(1, len(query_tokens)):
            title_first = " ".join(query_tokens[:split_at])
            artist_second = " ".join(query_tokens[split_at:])
            if title_matches(title_first, title) and artist_matches(artist_second, artist):
                score += 12
                break
            artist_first = " ".join(query_tokens[:split_at])
            title_second = " ".join(query_tokens[split_at:])
            if title_matches(title_second, title) and artist_matches(artist_first, artist):
                score += 12
                break

    if all(
        _token_in_text(token, title) or _token_in_text(token, artist) or token in norm_combined
        for token in query_tokens
    ):
        score += 5

    for split_at in range(1, len(query_tokens) + 1):
        wanted_title = " ".join(query_tokens[:split_at])
        wanted_artist = None if split_at == len(query_tokens) else " ".join(query_tokens[split_at:])
        if matches_requested_track(
            wanted_title=wanted_title,
            wanted_artist=wanted_artist,
            candidate_title=title,
            candidate_artist=artist or result.artist,
        ):
            score = max(score, 14)
            break

    return score


def _result_is_live(result: SearchResult) -> bool:
    return looks_like_live_version(_result_display_title(result), result.title)


def song_dedupe_key(result: SearchResult) -> str | None:
    return _song_dedupe_key(result)


def normalize_text(value: str) -> str:
    return _normalize_text(value)


def result_candidate_artist(result: SearchResult) -> str:
    return _result_candidate_artist(result)


def result_candidate_title(result: SearchResult) -> str:
    return _result_candidate_title(result)


def result_is_live(result: SearchResult) -> bool:
    return _result_is_live(result)


def song_title_key(result: SearchResult) -> str | None:
    """Normalized song title with live/venue markers stripped, ignoring artist."""
    _, parsed_title = _parsed_source_parts(result)
    base_title = re.sub(r"[\(\[].*?[\)\]]", " ", parsed_title)
    base_title = re.sub(
        r"([-–—|:]\s*)?\blive\b.*$|\bunplugged\b.*$",
        " ",
        base_title,
        flags=re.IGNORECASE,
    )
    return _normalize_text(base_title) or None


_VERSION_LABEL_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (_LOOP_RE, "Long mix"),
    (_FAN_UPLOAD_RE, "Cover"),
    (re.compile(r"\bremix\b", re.IGNORECASE), "Remix"),
    (re.compile(r"\bacoustic\b", re.IGNORECASE), "Acoustic"),
    (re.compile(r"\b(instrumental|karaoke)\b", re.IGNORECASE), "Instrumental"),
    (re.compile(r"\b(anniversary|re-?recorded|re-?recording)\b", re.IGNORECASE), "Re-recording"),
)


def version_marker_label(result: SearchResult) -> str | None:
    """Label a version from explicit markers in its title, if any."""
    display = _result_display_title(result)
    if _result_is_live(result):
        return "Live"
    for pattern, label in _VERSION_LABEL_PATTERNS:
        if pattern.search(display):
            return label
    return None


def version_marker_penalty(result: SearchResult) -> int:
    """Penalty (>=0) for title markers implying this is not the studio original."""
    display = _result_display_title(result)
    penalty = 0
    if _result_is_live(result):
        penalty += 4
    if _ALT_RECORDING_RE.search(display):
        penalty += 3
    if _LOOP_RE.search(display):
        penalty += 6
    if _FAN_UPLOAD_RE.search(display):
        penalty += 5
    if _ANIMATED_RE.search(display):
        penalty += 1
    return penalty


def _song_dedupe_key(result: SearchResult) -> str | None:
    """Collapse near-duplicate uploads of the same song (studio search only)."""
    _, parsed_title = _parsed_source_parts(result)
    # Strip live markers and trailing venue/date text so live variants share a key.
    base_title = re.sub(r"[\(\[].*?[\)\]]", " ", parsed_title)
    base_title = re.sub(
        r"([-–—|:]\s*)?\blive\b.*$|\bunplugged\b.*$",
        " ",
        base_title,
        flags=re.IGNORECASE,
    )
    title_key = _normalize_text(base_title)
    if not title_key:
        return None
    artist = _result_candidate_artist(result)
    if not artist:
        return None
    return f"{_normalize_text(artist)}|{title_key}"


def dedupe_search_results(
    results: list[SearchResult],
    *,
    max_per_song: int | None,
    song_counts: dict[str, int] | None = None,
) -> tuple[list[SearchResult], dict[str, int], int]:
    """Drop exact video duplicates; optionally cap uploads per song."""
    seen_ids: set[str] = set()
    counts = dict(song_counts or {})
    deduped: list[SearchResult] = []
    collapsed = 0
    for result in results:
        if result.video_id in seen_ids:
            continue
        seen_ids.add(result.video_id)
        if max_per_song is not None:
            song_key = _song_dedupe_key(result)
            if song_key is not None:
                current = counts.get(song_key, 0)
                if current >= max_per_song:
                    collapsed += 1
                    continue
                counts[song_key] = current + 1
        deduped.append(result)
    return deduped, counts, collapsed


def _search_rank_key(
    result: SearchResult,
    *,
    query: str,
    prefer_studio: bool,
    original_index: int,
) -> tuple[int, int, int, int]:
    # Ascending sort: relevance first, then soft live/topic preferences, then Piped order.
    relevance = query_relevance_score(query, result)
    is_live = _result_is_live(result)
    if prefer_studio:
        live_rank = 1 if is_live else 0
    else:
        live_rank = 0 if is_live else 1
    non_topic = 0 if is_topic_upload(result.artist) else 1
    return (-relevance, live_rank, non_topic, original_index)


def rank_search_results(
    query: str,
    results: list[SearchResult],
    *,
    version_preference: str = "auto",
) -> list[SearchResult]:
    if version_preference == "studio":
        prefer_studio = True
    elif version_preference in {"live", "any"}:
        prefer_studio = False
    else:
        prefer_studio = not query_requests_live(query)
    indexed = list(enumerate(results))
    indexed.sort(
        key=lambda pair: _search_rank_key(
            pair[1],
            query=query,
            prefer_studio=prefer_studio,
            original_index=pair[0],
        )
    )
    return [result for _, result in indexed]


def drop_irrelevant_results(query: str, results: list[SearchResult]) -> list[SearchResult]:
    """Discard results sharing nothing with the query.

    Upstream pages drift off topic as you go deeper, so reading several pages to
    fill a page of songs would otherwise pad the results with unrelated tracks.
    """
    scored = [(result, query_relevance_score(query, result)) for result in results]
    relevant = [result for result, score in scored if score > 0]
    return relevant or results


def apply_channel_pin_boost(
    results: list[SearchResult],
    *,
    artist_key: str | None,
    channel_name: str | None,
) -> list[SearchResult]:
    if not artist_key or not channel_name:
        return results
    normalized_artist = _normalize_text(artist_key)
    normalized_channel = _normalize_text(channel_name)
    if not normalized_artist or not normalized_channel:
        return results

    boosted: list[SearchResult] = []
    rest: list[SearchResult] = []
    for result in results:
        result_artist = _normalize_text(_result_candidate_artist(result))
        result_channel = _normalize_text(result.artist or "")
        if result_artist == normalized_artist and normalized_channel in result_channel:
            boosted.append(result)
        else:
            rest.append(result)
    return boosted + rest


def collect_playable_audio_streams(payload: dict) -> list[dict]:
    """Return audio-capable streams from a Piped /streams payload.

    YouTube Topic uploads often expose a single combined A/V stream under
    videoStreams (videoOnly=false) with an empty audioStreams list.
    """
    audio_streams = [
        stream
        for stream in payload.get("audioStreams", [])
        if stream.get("url") and not stream.get("videoOnly")
    ]
    if audio_streams:
        return audio_streams

    return [
        stream
        for stream in payload.get("videoStreams", [])
        if stream.get("url") and not stream.get("videoOnly")
    ]


def collect_video_playback_streams(payload: dict) -> list[dict]:
    """Return streams suitable for video playback (combined A/V preferred)."""
    combined = [
        stream
        for stream in payload.get("videoStreams", [])
        if stream.get("url") and not stream.get("videoOnly")
    ]
    if combined:
        return combined

    return [stream for stream in payload.get("videoStreams", []) if stream.get("url")]


def piped_instance_urls() -> list[str]:
    urls = [settings.piped_base_url, *settings.piped_fallback_urls.split(",")]
    seen: set[str] = set()
    ordered: list[str] = []
    for raw in urls:
        url = raw.strip().rstrip("/")
        if url and url not in seen:
            seen.add(url)
            ordered.append(url)
    return ordered


def _channel_id_from_uploader_url(uploader_url: str | None) -> str | None:
    if not uploader_url:
        return None
    return uploader_url.rstrip("/").rsplit("/", 1)[-1] or None


def _parse_search_items(payload: dict) -> list[SearchResult]:
    results: list[SearchResult] = []
    for item in payload.get("items", []):
        if item.get("type") != "stream":
            continue
        raw_title = (item.get("title") or "Unknown").strip()
        uploader = (item.get("uploaderName") or "").strip() or None
        if uploader:
            # music_songs entries already expose a clean song title plus the
            # performing artist as the uploader, so splitting on punctuation
            # only corrupts titles like "Up On the House-Top" or "Medley: ...".
            title = raw_title
            artist = uploader
        else:
            artist, title = parse_artist_title(raw_title)
        video_id = item["url"].split("=")[-1]
        short_description = item.get("shortDescription")
        if isinstance(short_description, str):
            short_description = short_description.strip() or None
        else:
            short_description = None
        results.append(
            SearchResult(
                video_id=video_id,
                title=title,
                artist=artist,
                thumbnail_url=youtube_thumbnail_url(video_id),
                duration_sec=item.get("duration"),
                source_title=raw_title,
                short_description=short_description,
                channel_id=_channel_id_from_uploader_url(item.get("uploaderUrl")),
            )
        )
    return results


def _next_page_token(payload: dict) -> str | None:
    next_page = payload.get("nextpage")
    if not next_page:
        return None
    return str(next_page)


_PIPED_REQUEST_TIMEOUT_SEC = 12.0


class PipedClient:
    def __init__(self) -> None:
        self._active_base_url: str | None = None

    @property
    def base_url(self) -> str:
        if self._active_base_url:
            return self._active_base_url
        urls = piped_instance_urls()
        return urls[0] if urls else settings.piped_base_url.rstrip("/")

    def _urls_for_request(self) -> list[str]:
        urls = piped_instance_urls()
        active = self._active_base_url
        if active and active in urls:
            return [active, *[url for url in urls if url != active]]
        return urls

    async def _request_json(self, path: str, *, params: dict | None = None) -> dict:
        errors: list[str] = []
        for base_url in self._urls_for_request():
            try:

                async def fetch_from_instance() -> dict:
                    async with httpx.AsyncClient(timeout=_PIPED_REQUEST_TIMEOUT_SEC) as client:
                        response = await client.get(f"{base_url}{path}", params=params)
                        response.raise_for_status()
                        try:
                            payload = response.json()
                        except ValueError as exc:
                            raise httpx.HTTPError(
                                f"Non-JSON response from {base_url}"
                            ) from exc
                        if not isinstance(payload, dict):
                            raise httpx.HTTPError(f"Unexpected JSON payload from {base_url}")
                        return payload

                # Prefer failing over to the next instance over retrying a dead one.
                payload = await with_retry(
                    fetch_from_instance,
                    max_attempts=1,
                    should_retry=is_transient_http_error,
                )
                self._active_base_url = base_url
                return payload
            except httpx.HTTPError as exc:
                if self._active_base_url == base_url:
                    self._active_base_url = None
                errors.append(f"{base_url}: {exc}")
        detail = "; ".join(errors[:3])
        raise httpx.HTTPError(f"All Piped instances failed. {detail}")

    async def _search_page(self, query: str, *, next_page: str | None) -> dict:
        if next_page:
            return await self._request_json(
                "/nextpage/search",
                params={"q": query, "filter": "music_songs", "nextpage": next_page},
            )
        return await self._request_json("/search", params={"q": query, "filter": "music_songs"})

    async def collect_candidates(
        self,
        query: str,
        *,
        target: int,
        next_page: str | None = None,
        seen_video_ids: set[str] | None = None,
        max_pages: int = 4,
    ) -> tuple[list[SearchResult], str | None]:
        """Pull upstream pages until we have ``target`` distinct songs.

        A single Piped page holds ~20 items, so duplicate uploads of one song
        are routinely split across pages. Grouping one page at a time can never
        merge those, which is why so few groups ever showed alternates. Progress
        is measured in distinct songs rather than raw results, because a page of
        twenty uploads of one song is one row to the reader.
        """
        collected: list[SearchResult] = []
        seen: set[str] = set(seen_video_ids or ())
        songs: set[str] = set()
        token = next_page
        for _ in range(max(1, max_pages)):
            payload = await self._search_page(query, next_page=token)
            for result in _parse_search_items(payload):
                if result.video_id in seen:
                    continue
                seen.add(result.video_id)
                collected.append(result)
                songs.add(song_title_key(result) or result.video_id)
            token = _next_page_token(payload)
            if not token or len(songs) >= target:
                break
        return collected, token

    async def search_piped(
        self,
        query: str,
        *,
        limit: int = 20,
        max_per_song: int | None = 1,
        version_preference: str = "auto",
        song_counts: dict[str, int] | None = None,
        seen_video_ids: set[str] | None = None,
        channel_pins: dict[str, str] | None = None,
    ) -> tuple[list[SearchResult], str | None, dict[str, int], int]:
        payload = await self._request_json("/search", params={"q": query, "filter": "music_songs"})
        results = _parse_search_items(payload)
        results = [r for r in results if not seen_video_ids or r.video_id not in seen_video_ids]
        if channel_pins:
            for artist_key, channel_name in channel_pins.items():
                results = apply_channel_pin_boost(results, artist_key=artist_key, channel_name=channel_name)
        results = rank_search_results(query, results, version_preference=version_preference)
        results, counts, collapsed = dedupe_search_results(
            results,
            max_per_song=max_per_song,
            song_counts=song_counts,
        )
        return results[:limit], _next_page_token(payload), counts, collapsed

    async def search_piped_next(
        self,
        query: str,
        next_page: str,
        *,
        limit: int = 20,
        max_per_song: int | None = 1,
        version_preference: str = "auto",
        song_counts: dict[str, int] | None = None,
        seen_video_ids: set[str] | None = None,
        channel_pins: dict[str, str] | None = None,
    ) -> tuple[list[SearchResult], str | None, dict[str, int], int]:
        payload = await self._request_json(
            "/nextpage/search",
            params={"q": query, "filter": "music_songs", "nextpage": next_page},
        )
        results = _parse_search_items(payload)
        results = [r for r in results if not seen_video_ids or r.video_id not in seen_video_ids]
        if channel_pins:
            for artist_key, channel_name in channel_pins.items():
                results = apply_channel_pin_boost(results, artist_key=artist_key, channel_name=channel_name)
        results = rank_search_results(query, results, version_preference=version_preference)
        results, counts, collapsed = dedupe_search_results(
            results,
            max_per_song=max_per_song,
            song_counts=song_counts,
        )
        return results[:limit], _next_page_token(payload), counts, collapsed

    async def search(self, query: str, limit: int = 20) -> list[SearchResult]:
        results, _, _, _ = await self.search_piped(query, limit=limit)
        return results

    async def get_stream(self, video_id: str) -> StreamInfo:
        payload = await self._request_json(f"/streams/{video_id}")

        audio_streams = collect_playable_audio_streams(payload)
        if not audio_streams:
            raise ValueError("No audio stream available for this video")

        best = max(audio_streams, key=lambda s: s.get("bitrate", 0) or 0)
        artist, title = parse_artist_title(payload.get("title", "Unknown"))
        video_streams = collect_video_playback_streams(payload)
        has_video = bool(video_streams)
        video_mime_type = None
        if video_streams:
            video_best = max(video_streams, key=lambda s: s.get("bitrate", 0) or 0)
            video_mime_type = video_best.get("mimeType") or "video/mp4"

        return StreamInfo(
            video_id=video_id,
            title=title,
            artist=artist or payload.get("uploader"),
            thumbnail_url=youtube_thumbnail_url(video_id),
            duration_sec=payload.get("duration"),
            audio_url=best["url"],
            mime_type=best.get("mimeType") or "audio/webm",
            has_video=has_video,
            video_mime_type=video_mime_type,
        )


piped_client = PipedClient()
