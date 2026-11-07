package dev.tuneflow

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.recyclerview.widget.DiffUtil
import androidx.recyclerview.widget.ItemTouchHelper
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView

/** A single scrolling surface for the player and both queues; only visible rows are inflated. */
class PlayerQueuePanel(
    context: Context,
    private val player: Player,
    private val header: View,
    private val artwork: (ImageView, String?) -> Unit,
    private val info: (MediaItem) -> Unit,
) : RecyclerView(context) {
    private data class Row(val key: String, val title: String = "", val subtitle: String = "", val item: MediaItem? = null)
    private var rows = emptyList<Row>()
    private var dragging = false
    private val dim = Color.rgb(166, 171, 180)
    private val mint = Color.rgb(80, 216, 143)
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun label(value: String, size: Float, color: Int = Color.WHITE) = TextView(context).apply {
        text = value; textSize = size; setTextColor(color)
    }
    private class Holder(val container: LinearLayout) : ViewHolder(container)
    private val queueAdapter: Adapter<Holder> = object : Adapter<Holder>() {
        override fun getItemCount() = rows.size
        override fun getItemViewType(position: Int) = if (position == 0) 0 else 1
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder = Holder(LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL; layoutParams = LayoutParams(-1, -2)
        })
        override fun onBindViewHolder(holder: Holder, position: Int) {
            val row = rows[position]; val container = holder.container
            container.removeAllViews(); container.setPadding(0, 0, 0, 0)
            container.setOnLongClickListener(null); container.setOnClickListener(null)
            if (position == 0) {
                (header.parent as? ViewGroup)?.removeView(header); container.addView(header); return
            }
            val media = row.item
            if (media == null) {
                container.setPadding(dp(4), dp(24), dp(4), dp(12))
                container.addView(label(row.title, 21f).apply { setTypeface(null, Typeface.BOLD) })
                container.addView(label(row.subtitle, 13f, dim).apply { setPadding(0, dp(6), 0, 0) })
                return
            }
            val line = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                setPadding(dp(2), dp(8), 0, dp(8)); minimumHeight = dp(68)
            }
            val art = ImageView(context).apply { scaleType = ImageView.ScaleType.CENTER_CROP }
            line.addView(art, LinearLayout.LayoutParams(dp(46), dp(46)))
            artwork(art, media.mediaMetadata.artworkUri?.toString())
            val labels = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(12), 0, dp(4), 0) }
            labels.addView(label(media.mediaMetadata.title?.toString().orEmpty(), 15f).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END })
            labels.addView(label(media.mediaMetadata.artist?.toString().orEmpty(), 12f, dim).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END; setPadding(0, dp(4), 0, 0) })
            line.addView(labels, LinearLayout.LayoutParams(0, -2, 1f))
            fun currentIndex(): Int = (player.currentMediaItemIndex + 1 until player.mediaItemCount)
                .firstOrNull { PlaybackQueue.entry(player.getMediaItemAt(it)) == row.key } ?: -1
            labels.setOnClickListener {
                val index = currentIndex()
                if (index > player.currentMediaItemIndex) {
                    // Play this request next without discarding the other pending songs.
                    if (PlaybackQueue.lane(media) == PlaybackQueue.CONTEXT) {
                        player.removeMediaItem(index)
                        PlaybackQueue.add(player, media, next = true)
                    } else player.moveMediaItem(index, player.currentMediaItemIndex + 1)
                    player.seekToNextMediaItem(); player.prepare(); player.play()
                }
            }
            labels.setOnLongClickListener { touch.startDrag(holder); true }
            val menu = label("⋮", 24f, dim).apply { gravity = Gravity.CENTER; contentDescription = "Options for ${media.mediaMetadata.title}"; setOnClickListener { info(media) } }
            line.addView(menu, LinearLayout.LayoutParams(dp(40), dp(48)))
            val remove = label("×", 24f, dim).apply {
                gravity = Gravity.CENTER; contentDescription = "Remove ${media.mediaMetadata.title} from queue"
                setOnClickListener { val index = currentIndex(); if (index >= 0) player.removeMediaItem(index) }
            }
            line.addView(remove, LinearLayout.LayoutParams(dp(40), dp(48)))
            val handle = label("≡", 24f, dim).apply {
                gravity = Gravity.CENTER; contentDescription = "Hold and drag ${media.mediaMetadata.title} to reorder"
                setOnLongClickListener { touch.startDrag(holder); true }
            }
            line.addView(handle, LinearLayout.LayoutParams(dp(40), dp(48)))
            container.addView(line)
            container.setOnLongClickListener { touch.startDrag(holder); true }
        }
    }
    private val touch: ItemTouchHelper = ItemTouchHelper(object : ItemTouchHelper.SimpleCallback(ItemTouchHelper.UP or ItemTouchHelper.DOWN, 0) {
        override fun getMovementFlags(recyclerView: RecyclerView, viewHolder: ViewHolder): Int =
            if (rows.getOrNull(viewHolder.bindingAdapterPosition)?.item != null) super.getMovementFlags(recyclerView, viewHolder) else 0
        override fun onMove(recyclerView: RecyclerView, viewHolder: ViewHolder, target: ViewHolder): Boolean {
            val from = viewHolder.bindingAdapterPosition; val to = target.bindingAdapterPosition
            val a = rows.getOrNull(from)?.item ?: return false
            val b = rows.getOrNull(to)?.item ?: return false
            if (PlaybackQueue.lane(a) != PlaybackQueue.lane(b)) return false
            fun index(item: MediaItem) = (player.currentMediaItemIndex + 1 until player.mediaItemCount)
                .firstOrNull { PlaybackQueue.entry(player.getMediaItemAt(it)) == PlaybackQueue.entry(item) } ?: -1
            val source = index(a); val destination = index(b)
            if (source < 0 || destination < 0) return false
            player.moveMediaItem(source, destination)
            rows = rows.toMutableList().apply { add(to, removeAt(from)) }
            queueAdapter.notifyItemMoved(from, to)
            return true
        }
        override fun onSwiped(viewHolder: ViewHolder, direction: Int) {}
        override fun onSelectedChanged(viewHolder: ViewHolder?, actionState: Int) {
            dragging = actionState == ItemTouchHelper.ACTION_STATE_DRAG
            viewHolder?.itemView?.apply { alpha = 0.9f; elevation = dp(8).toFloat(); setBackgroundColor(Color.rgb(38, 48, 42)) }
            super.onSelectedChanged(viewHolder, actionState)
        }
        override fun clearView(recyclerView: RecyclerView, viewHolder: ViewHolder) {
            super.clearView(recyclerView, viewHolder)
            viewHolder.itemView.apply { alpha = 1f; elevation = 0f; setBackgroundColor(Color.TRANSPARENT) }
            dragging = false; post { refresh() }
        }
    })
    private val listener = object : Player.Listener {
        override fun onEvents(player: Player, events: Player.Events) {
            if (events.containsAny(Player.EVENT_TIMELINE_CHANGED, Player.EVENT_MEDIA_ITEM_TRANSITION)) post { if (!dragging) refresh() }
        }
    }
    init {
        layoutManager = LinearLayoutManager(context); adapter = queueAdapter
        clipToPadding = false; setPadding(dp(20), 0, dp(20), dp(28))
        touch.attachToRecyclerView(this); refresh()
    }
    override fun onAttachedToWindow() { super.onAttachedToWindow(); player.addListener(listener); refresh() }
    override fun onDetachedFromWindow() { player.removeListener(listener); super.onDetachedFromWindow() }
    private fun refresh() {
        val upcoming = ((player.currentMediaItemIndex + 1).coerceAtLeast(0) until player.mediaItemCount).map(player::getMediaItemAt)
        val manual = upcoming.filter { PlaybackQueue.lane(it) == PlaybackQueue.MANUAL }
        val context = upcoming.filter { PlaybackQueue.lane(it) != PlaybackQueue.MANUAL }
        val old = rows
        rows = buildList {
            add(Row("header"))
            add(Row("manual", "Your queue · ${manual.size}", if (manual.isEmpty()) "Add a song from its ⋮ menu. Your requests play first." else "Plays next · hold and drag to reorder"))
            manual.forEach { add(Row(PlaybackQueue.entry(it), item = it)) }
            add(Row("context", "${context.firstOrNull()?.let(PlaybackQueue::context) ?: "Playlist"} · ${context.size}", if (context.isEmpty()) "Start a playlist, album or Play all to fill this queue." else "Continues after your queue · hold and drag to reorder"))
            context.forEach { add(Row(PlaybackQueue.entry(it), item = it)) }
        }
        DiffUtil.calculateDiff(object : DiffUtil.Callback() {
            override fun getOldListSize() = old.size
            override fun getNewListSize() = rows.size
            override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int) = old[oldItemPosition].key == rows[newItemPosition].key
            override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int) = old[oldItemPosition] == rows[newItemPosition]
        }).dispatchUpdatesTo(queueAdapter)
    }
}
