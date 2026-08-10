from app.services.search_options import build_search_explanation
from app.schemas import SearchOptions
from app.services.ytdlp import (
    _entry_needs_enrichment,
    _merge_entry_metadata,
    entry_to_search_result,
)


def test_entry_to_search_result_maps_flat_fields():
    result = entry_to_search_result(
        {
            "id": "abcdefghijk",
            "title": "The Beatles - Let It Be",
            "uploader": "The Beatles",
            "duration": 243.0,
            "channel_id": "UCxxxxxxxxxxxxxxxxxxxxxx",
            "description": "Official audio",
        }
    )
    assert result is not None
    assert result.video_id == "abcdefghijk"
    assert result.artist == "The Beatles"
    assert result.title == "Let It Be"
    assert result.duration_sec == 243
    assert result.channel_id == "UCxxxxxxxxxxxxxxxxxxxxxx"
    assert result.source_title == "The Beatles - Let It Be"


def test_entry_needs_enrichment_when_sparse():
    assert _entry_needs_enrichment({"id": "x", "title": "Song"}) is True
    assert (
        _entry_needs_enrichment(
            {
                "id": "x",
                "title": "Song",
                "duration": 120,
                "uploader": "Artist",
                "channel_id": "UCabc",
            }
        )
        is False
    )


def test_merge_entry_metadata_fills_gaps_only():
    merged = _merge_entry_metadata(
        {"id": "x", "title": "Keep Me", "duration": None},
        {"title": "Ignore", "duration": 99, "uploader": "Artist", "channel_id": "UCabc"},
    )
    assert merged["title"] == "Keep Me"
    assert merged["duration"] == 99
    assert merged["uploader"] == "Artist"
    assert merged["channel_id"] == "UCabc"


def test_build_search_explanation_extra_messages():
    explanation = build_search_explanation(
        options=SearchOptions(),
        household=None,
        parental=None,
        filtered_count=0,
        collapsed_count=0,
        extra_messages=["Using backup search — Piped was unavailable"],
    )
    assert explanation is not None
    assert explanation.messages[0].startswith("Using backup search")
