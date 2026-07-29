from app.schemas import SearchResult
from app.services.piped import (
    dedupe_search_results,
    query_relevance_score,
    rank_search_results,
)


def _result(
    video_id: str,
    *,
    title: str,
    artist: str | None = None,
    source_title: str | None = None,
) -> SearchResult:
    return SearchResult(
        video_id=video_id,
        title=title,
        artist=artist,
        thumbnail_url=None,
        source_title=source_title or title,
    )


def test_dedupe_keeps_distinct_artists_with_same_title():
    results = [
        _result("adele1", title="Hello", artist="Adele - Topic", source_title="Hello"),
        _result("richie1", title="Hello", artist="Lionel Richie - Topic", source_title="Hello"),
        _result("other1", title="Hello", artist="Someone Else - Topic", source_title="Hello"),
    ]

    deduped, counts, collapsed = dedupe_search_results(results, max_per_song=1)

    assert [result.video_id for result in deduped] == ["adele1", "richie1", "other1"]
    assert collapsed == 0
    assert len(counts) == 3


def test_dedupe_collapses_duplicate_uploads_for_same_artist():
    results = [
        _result("adele1", title="Hello", artist="Adele - Topic", source_title="Hello"),
        _result("adele2", title="Hello", artist="Adele - Topic", source_title="Hello (Official Audio)"),
    ]

    deduped, counts, collapsed = dedupe_search_results(results, max_per_song=1)

    assert [result.video_id for result in deduped] == ["adele1"]
    assert collapsed == 1


def test_dedupe_allows_multiple_versions_when_configured():
    results = [
        _result("adele1", title="Hello", artist="Adele - Topic", source_title="Hello"),
        _result("adele2", title="Hello", artist="Adele - Topic", source_title="Hello (Official Audio)"),
        _result("adele3", title="Hello", artist="Adele - Topic", source_title="Hello (Live)"),
    ]

    deduped, counts, collapsed = dedupe_search_results(results, max_per_song=2)

    assert [result.video_id for result in deduped] == ["adele1", "adele2"]
    assert collapsed == 1
    assert counts["adele|hello"] == 2


def test_query_relevance_prefers_title_and_artist_match():
    adele = _result("adele1", title="Hello", artist="Adele - Topic", source_title="Hello")
    random_hello = _result("other1", title="Hello", artist="Random Artist", source_title="Hello")
    adele_other = _result("adele2", title="Someone Like You", artist="Adele - Topic", source_title="Someone Like You")

    assert query_relevance_score("Hello Adele", adele) > query_relevance_score("Hello Adele", random_hello)
    assert query_relevance_score("Hello Adele", adele) > query_relevance_score("Hello Adele", adele_other)


def test_rank_search_results_boosts_exact_match_and_preserves_piped_order_on_ties():
    adele = _result("adele1", title="Hello", artist="Adele - Topic", source_title="Hello")
    random_hello = _result("other1", title="Hello", artist="Random Artist", source_title="Hello")
    another_hello = _result("other2", title="Hello", artist="Another Artist", source_title="Hello")

    ranked = rank_search_results(
        "Hello Adele",
        [random_hello, another_hello, adele],
    )

    assert ranked[0].video_id == "adele1"
    assert [result.video_id for result in ranked[1:]] == ["other1", "other2"]


def test_rank_search_results_prefers_live_when_query_requests_live():
    studio = _result(
        "studio1vid",
        title="Hello",
        artist="Adele - Topic",
        source_title="Hello",
    )
    live = _result(
        "live01vid",
        title="Hello (Live at Royal Albert Hall)",
        artist="Adele - Topic",
        source_title="Adele - Hello (Live at Royal Albert Hall)",
    )

    ranked = rank_search_results("Hello Adele live", [studio, live])

    assert ranked[0].video_id == "live01vid"
