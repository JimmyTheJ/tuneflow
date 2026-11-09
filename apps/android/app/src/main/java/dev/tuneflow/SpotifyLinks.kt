package dev.tuneflow

/** Spotify's share sheet may include a title alongside the URL. Keep only a supported link. */
object SpotifyLinks {
    fun fromSharedText(text: String): String? = Regex("https://(?:open\\.spotify\\.com|spotify\\.link)/[^\\s<>\\\"]+|spotify:playlist:[A-Za-z0-9]{22}")
        .findAll(text).map { it.value.trimEnd('.', ',', ')') }.firstOrNull { link ->
            link.startsWith("https://spotify.link/") || link.startsWith("spotify:playlist:") ||
                Regex("https://open\\.spotify\\.com/(?:intl-[A-Za-z-]+/)?(?:embed/)?playlist/[A-Za-z0-9]{22}(?:[/?#].*)?").matches(link)
        }
}
