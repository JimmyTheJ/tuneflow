from app.models import Household, ParentalSettings
from app.schemas import SearchOptions
from app.services.search_options import (
    build_search_explanation,
    decode_search_cursor,
    encode_search_cursor,
    max_per_song_from_query,
    resolve_search_options,
    SearchCursor,
)


def test_max_per_song_from_query():
    assert max_per_song_from_query(None) is None
    assert max_per_song_from_query(0) is None
    assert max_per_song_from_query(3) == 3


def test_resolve_search_options_applies_parental_ceiling():
    household = Household(name="Test", slug="test", search_defaults_json='{"max_per_song": 5}')
    parental = ParentalSettings(
        child_user_id=1,
        search_max_versions_ceiling=2,
    )
    effective = resolve_search_options(
        household=household,
        parental=parental,
        requested=SearchOptions(max_per_song=5),
    )
    assert effective.max_per_song == 2


def test_resolve_search_options_blocks_session_override_when_locked():
    household = Household(name="Test", slug="test", search_defaults_json="{}")
    parental = ParentalSettings(child_user_id=1, search_locked=True)
    effective = resolve_search_options(
        household=household,
        parental=parental,
        requested=SearchOptions(max_per_song=None),
    )
    assert effective.max_per_song == SearchOptions().max_per_song


def test_resolve_search_options_keeps_household_play_on_select():
    household = Household(
        name="Test",
        slug="test",
        search_defaults_json='{"play_on_select": "single_track"}',
    )
    effective = resolve_search_options(
        household=household,
        parental=None,
        requested=SearchOptions(max_per_song=5),
    )
    assert effective.play_on_select == "single_track"
    assert effective.max_per_song == 5


def test_options_fingerprint_ignores_play_on_select():
    from app.services.search_options import options_fingerprint

    a = SearchOptions(play_on_select="all_results")
    b = SearchOptions(play_on_select="single_track")
    assert options_fingerprint(a) == options_fingerprint(b)


def test_search_cursor_round_trip():
    cursor = SearchCursor(
        piped_nextpage="abc123",
        seen_video_ids=["vid1"],
        emitted_group_keys=["song:babybeluga"],
        options_fingerprint="fp",
    )
    token = encode_search_cursor(cursor)
    assert token is not None
    decoded = decode_search_cursor(token, expected_fingerprint="fp")
    assert decoded is not None
    assert decoded.piped_nextpage == "abc123"
    assert decoded.seen_video_ids == ["vid1"]
    assert decoded.emitted_group_keys == ["song:babybeluga"]


def test_build_search_explanation_includes_filters():
    explanation = build_search_explanation(
        options=SearchOptions(max_per_song=1, hide_covers=True),
        household=None,
        parental=None,
        filtered_count=3,
        collapsed_count=2,
    )
    assert explanation is not None
    assert any("Filtered 3" in message for message in explanation.messages)
    assert any("Collapsed 2" in message for message in explanation.messages)
