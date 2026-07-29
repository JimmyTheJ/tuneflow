from app.schemas import SearchResult
from app.services.song_groups import (
    SongIdentity,
    build_song_groups,
    consensus_duration,
    group_key_for,
)
from app.services.piped import song_title_key


def _result(
    video_id: str,
    *,
    title: str,
    artist: str | None = None,
    duration_sec: int | None = None,
    channel_id: str | None = None,
) -> SearchResult:
    return SearchResult(
        video_id=video_id,
        title=title,
        artist=artist,
        thumbnail_url=None,
        duration_sec=duration_sec,
        source_title=title,
        channel_id=channel_id,
    )


def _identities(results, *, artist, duration_sec=None):
    from app.services.song_groups import artist_channel_ids

    keys = {song_title_key(result) for result in results}
    identity = SongIdentity(
        artist_name=artist,
        artist_channel_ids=artist_channel_ids(results, artist),
        duration_sec=duration_sec,
    )
    return {key: identity for key in keys if key}


def test_music_songs_titles_are_not_split_on_punctuation():
    # Piped music_songs entries carry a bare song title, so "Artist - Title"
    # parsing would previously turn this into artist "Up On the House".
    result = _result("housetop001", title="Up On the House-Top", artist="Raffi")
    assert song_title_key(result) == "uponthehousetop"


def test_studio_original_wins_over_cover_by_another_uploader():
    raffi = _result("raffi000001", title="Baby Beluga", artist="Raffi", duration_sec=161, channel_id="UCraffi")
    cover = _result("cover000001", title="Baby Beluga", artist="CoComelon", duration_sec=148, channel_id="UCcoco")
    results = [cover, raffi]  # upstream order puts the cover first

    identities = _identities(results, artist="Raffi, Ken Whiteley", duration_sec=160)
    groups, _ = build_song_groups(results, max_per_song=3, identities=identities)

    assert len(groups) == 1
    assert groups[0].primary.video_id == "raffi000001"
    assert [alt.video_id for alt in groups[0].alternates] == ["cover000001"]
    assert groups[0].alternates[0].version_label == "Cover"


def test_canonical_duration_picks_the_studio_take_over_a_re_recording():
    studio = _result("studio00001", title="Everything Grows", artist="Raffi", duration_sec=153, channel_id="UCraffi")
    longer = _result("rerec000001", title="Everything Grows", artist="Raffi", duration_sec=190, channel_id="UCraffi")
    results = [longer, studio]

    identities = _identities(results, artist="Raffi", duration_sec=152)
    groups, _ = build_song_groups(results, max_per_song=3, identities=identities)

    assert groups[0].primary.video_id == "studio00001"


def test_unattributed_songs_keep_artist_in_the_group_key():
    # Without a canonical artist we must not merge same-titled different songs.
    adele = _result("adele00001x", title="Hello", artist="Adele", duration_sec=295)
    richie = _result("richie0001x", title="Hello", artist="Lionel Richie", duration_sec=247)

    assert group_key_for(adele, None) != group_key_for(richie, None)

    groups, _ = build_song_groups([adele, richie], max_per_song=3, identities={})
    assert len(groups) == 2


def test_group_reports_total_versions_beyond_the_cap():
    results = [
        _result(f"vid{index:08d}", title="Baby Beluga", artist="Raffi", duration_sec=161, channel_id="UCraffi")
        for index in range(6)
    ]
    identities = _identities(results, artist="Raffi", duration_sec=160)

    groups, collapsed = build_song_groups(results, max_per_song=3, identities=identities)

    assert len(groups) == 1
    assert len(groups[0].alternates) == 2
    assert groups[0].total_versions == 6
    assert collapsed == 3


def test_live_upload_is_labelled_and_ranked_below_the_studio_take():
    studio = _result("studio00002", title="Bathtime", artist="Raffi", duration_sec=163, channel_id="UCraffi")
    live = _result("live000002x", title="Bathtime (Live at Carnegie Hall)", artist="Raffi", duration_sec=179, channel_id="UCraffi")
    results = [live, studio]

    identities = _identities(results, artist="Raffi", duration_sec=163)
    groups, _ = build_song_groups(results, max_per_song=3, identities=identities)

    assert len(groups) == 1
    assert groups[0].primary.video_id == "studio00002"
    assert groups[0].alternates[0].version_label == "Live"


def test_consensus_duration_finds_the_dominant_cluster():
    # Three uploads of one recording plus two scattered covers.
    assert consensus_duration([161, 160, 162, 114, 209]) == 161
    assert consensus_duration([100, 200]) is None
    assert consensus_duration([]) is None
