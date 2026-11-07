package dev.tuneflow

import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.Player

/** One player timeline: current item, explicit requests, then the remaining context. */
object PlaybackQueue {
    const val MANUAL = "manual"
    const val CONTEXT = "context"
    fun lane(item: MediaItem) = item.mediaMetadata.extras?.getString("queue_lane") ?: CONTEXT
    fun context(item: MediaItem) = item.mediaMetadata.extras?.getString("queue_context") ?: "Playlist"
    fun entry(item: MediaItem) = item.mediaMetadata.extras?.getString("queue_entry") ?: item.mediaId
    fun tagged(item: MediaItem, lane: String, context: String = "Playlist"): MediaItem {
        val extras = Bundle(item.mediaMetadata.extras ?: Bundle()).apply {
            putString("queue_lane", lane); putString("queue_context", context)
            putString("queue_entry", java.util.UUID.randomUUID().toString())
        }
        return item.buildUpon().setMediaMetadata(item.mediaMetadata.buildUpon().setExtras(extras).build()).build()
    }
    fun manualEnd(player: Player): Int {
        var index = (player.currentMediaItemIndex + 1).coerceAtLeast(0)
        while (index < player.mediaItemCount && lane(player.getMediaItemAt(index)) == MANUAL) index++
        return index
    }
    fun add(player: Player, item: MediaItem, next: Boolean = false) {
        if (player.playbackState == Player.STATE_ENDED) player.clearMediaItems()
        val empty = player.mediaItemCount == 0
        val index = if (empty) 0 else if (next) player.currentMediaItemIndex + 1 else manualEnd(player)
        player.shuffleModeEnabled = false
        player.addMediaItem(index, tagged(item, MANUAL))
        if (empty) { player.prepare(); player.play() }
    }
    fun consumePlayed(player: Player) {
        val count = player.currentMediaItemIndex
        if (count <= 0) return
        val repeat = if (player.repeatMode == Player.REPEAT_MODE_ALL)
            (0 until count).map(player::getMediaItemAt).filter { lane(it) == CONTEXT }
        else emptyList()
        player.removeMediaItems(0, count)
        if (repeat.isNotEmpty()) player.addMediaItems(repeat)
    }
}
