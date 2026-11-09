package dev.tuneflow
import org.junit.Assert.*
import org.junit.Test
class SpotifyLinksTest {
    @Test fun acceptsAndroidShareTextLocalizedUrlsAndShortLinks() {
        val link = "https://open.spotify.com/playlist/0123456789abcdefghijkl?si=android"
        assertEquals(link, SpotifyLinks.fromSharedText("Listen to this playlist: $link"))
        assertNotNull(SpotifyLinks.fromSharedText("https://open.spotify.com/intl-de/playlist/0123456789abcdefghijkl"))
        assertEquals("https://spotify.link/abc123", SpotifyLinks.fromSharedText("https://spotify.link/abc123"))
        assertNotNull(SpotifyLinks.fromSharedText("spotify:playlist:0123456789abcdefghijkl"))
    }
    @Test fun rejectsNonPlaylistLinksAndLookalikeHosts() {
        for (text in listOf("https://evil.test/playlist/0123456789abcdefghijkl", "https://open.spotify.com.evil.test/playlist/0123456789abcdefghijkl", "https://open.spotify.com/track/0123456789abcdefghijkl", "random text"))
            assertNull(SpotifyLinks.fromSharedText(text))
    }
}
