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
}
