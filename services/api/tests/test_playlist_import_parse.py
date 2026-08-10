from app.services.spotify import parse_spotify_playlist_id
from app.services.youtube_playlist import parse_youtube_playlist_id


def test_parse_youtube_playlist_id_from_url():
    assert (
        parse_youtube_playlist_id("https://www.youtube.com/playlist?list=PLabc123DEF456_7890xyz")
        == "PLabc123DEF456_7890xyz"
    )
    assert (
        parse_youtube_playlist_id("https://youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123DEF456_7890xyz")
        == "PLabc123DEF456_7890xyz"
    )


def test_parse_youtube_playlist_id_raw():
    assert parse_youtube_playlist_id("PLabc123DEF456_7890xyz") == "PLabc123DEF456_7890xyz"
    assert parse_youtube_playlist_id("not-a-playlist") is None


def test_parse_spotify_playlist_id_from_url():
    pid = "37i9dQZF1DXcBWIGoYBM5M"
    assert parse_spotify_playlist_id(f"https://open.spotify.com/playlist/{pid}") == pid
    assert parse_spotify_playlist_id(f"https://open.spotify.com/intl-de/playlist/{pid}?si=abc") == pid
    assert parse_spotify_playlist_id(f"spotify:playlist:{pid}") == pid
    assert parse_spotify_playlist_id(pid) == pid
    assert parse_spotify_playlist_id("https://open.spotify.com/track/abc") is None
