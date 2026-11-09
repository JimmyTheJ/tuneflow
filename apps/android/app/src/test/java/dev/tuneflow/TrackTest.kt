package dev.tuneflow
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
class TrackTest {
    @Test fun libraryAndYoutubeIdentitiesSurviveSerialization() {
        for (id in listOf("jf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "abcdefghijk")) {
            val track = Track(id, "Title", "Artist", 180)
            assertEquals(track, Track.from(track.json()))
        }
    }
    @Test fun nullMetadataIsNotShownAsLiteralNull() {
        val track = Track.from(JSONObject("""{"video_id":"abcdefghijk","title":"Title","artist":null,"thumbnail_url":null,"blocked_reason":null}"""))
        assertEquals("", track.artist); assertEquals("", track.artwork); assertEquals("", track.blocked)
    }
    @Test fun jellyfinAlbumOrderAndMetadataSurviveParsing() {
        val track = Track.from(JSONObject("""{"video_id":"jf_abc","title":"Song","artist":"Singer","album":"Album","album_id":"album-1","album_artist":"Band","disc_number":2,"track_number":4}"""))
        assertEquals("Album", track.album)
        assertEquals("album-1", track.albumId)
        assertEquals("Band", track.albumArtist)
        assertEquals(2, track.discNumber)
        assertEquals(4, track.trackNumber)
        assertEquals(track, Track.from(track.json()))
    }
    @Test fun youtubeInformationAndRestrictionsSurviveSavedResults() {
        val track = Track("abcdefghijk", "A long title", "Artist", 180, blocked = "Blocked",
            sourceTitle = "Full original upload title", uploader = "Uploader", channelId = "UCfixture")
        assertEquals(track, Track.from(track.json()))
    }
    @Test fun playlistEntryIdentityAndContributorSurvivePlaybackMetadata() {
        val track = Track.from(JSONObject("""{"video_id":"abcdefghijk","title":"Song","id":42,"playlist_id":7,"added_by_user_id":3,"added_by_display_name":"Member","added_at":"2026-11-08 12:00:00"}"""))
        assertEquals(42L, track.playlistTrackId)
        assertEquals(7L, track.playlistId)
        assertEquals("Member", track.addedBy)
        assertEquals(track, Track.from(track.json()))
    }
}
