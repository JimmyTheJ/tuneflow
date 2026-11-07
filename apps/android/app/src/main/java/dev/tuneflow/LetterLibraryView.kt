package dev.tuneflow

import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.os.Parcelable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import androidx.recyclerview.widget.DiffUtil
import kotlinx.coroutines.*
import org.json.JSONObject

internal data class BrowseGroup(val id: String, val title: String, val subtitle: String, val detail: String, val artwork: String = "")

internal object LibraryLetters {
    val keys = listOf("#") + ('0'..'9').map(Char::toString) + ('A'..'Z').map(Char::toString)
    fun initial(value: String): String = value.trim(' ').firstOrNull()?.let {
        val letter = it.uppercaseChar()
        if (letter in 'A'..'Z' && it.code < 128 || letter in '0'..'9') letter.toString() else "#"
    } ?: "#"
}

/** Retain the open letter and scroll position when returning from an artist/album. */
internal class LetterLibraryState {
    var query = ""
    var counts: Map<String, Int>? = null
    val expanded = mutableSetOf<String>()
    val entries = mutableMapOf<String, List<BrowseGroup>>()
    val complete = mutableSetOf<String>()
    var scroll: Parcelable? = null
}

/** Virtualized letter headers and entries; collapsed sections never fetch entries or artwork. */
internal class LetterLibraryView(
    context: Context,
    private val header: View,
    private val state: LetterLibraryState,
    private val pageScope: CoroutineScope,
    private val api: Api,
    private val section: String,
    private val viewMode: () -> String,
    private val mapEntry: (JSONObject) -> BrowseGroup,
    private val renderEntries: (LinearLayout, List<BrowseGroup>) -> Unit,
) : RecyclerView(context) {
    private data class Row(val key: String, val letter: String = "", val entries: List<BrowseGroup>? = null, val status: String = "")
    private var rows = emptyList<Row>()
    private var indexJob: Job? = null
    private val jobs = mutableMapOf<String, Job>()
    private val errors = mutableMapOf<String, String>()
    private var indexError: String? = null
    private var loadingIndex = false
    private var pendingPicker = false
    private var generation = 0
    private var pendingScroll: Parcelable? = state.scroll
    private val dim = Color.rgb(166, 171, 180)
    private val mint = Color.rgb(80, 216, 143)
    private val pageSize = 40
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun label(value: String, size: Float = 15f, color: Int = dim) = TextView(context).apply {
        text = value; textSize = size; setTextColor(color); setPadding(dp(8), dp(12), dp(8), dp(12))
    }
    private class Holder(val container: LinearLayout) : ViewHolder(container)
    private val libraryAdapter: Adapter<Holder> = object : Adapter<Holder>() {
        override fun getItemCount() = rows.size
        override fun getItemViewType(position: Int) = if (position == 0) 0 else 1
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL; layoutParams = LayoutParams(-1, -2)
        })
        override fun onBindViewHolder(holder: Holder, position: Int) {
            val row = rows[position]; val container = holder.container
            container.removeAllViews(); container.alpha = 1f; container.setOnClickListener(null); container.contentDescription = null
            container.setPadding(0, 0, 0, 0)
            if (row.key == "header") {
                (header.parent as? ViewGroup)?.removeView(header); container.addView(header); return
            }
            if (row.entries != null) { renderEntries(container, row.entries); return }
            if (row.key == "index") {
                container.addView(label(indexError?.let { "$it · Tap to retry" } ?: if (loadingIndex) "Loading letters…" else "No matches. Try another search or sync Jellyfin in Settings."))
                if (indexError != null) container.setOnClickListener { refreshIndex() }
                return
            }
            val letter = row.letter
            if (row.key == "letter:$letter") {
                val total = state.counts?.get(letter) ?: 0
                val open = letter in state.expanded
                val line = LinearLayout(context).apply {
                    orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                    minimumHeight = dp(56); setPadding(dp(6), 0, dp(6), 0)
                }
                line.addView(label(letter, 23f, if (total > 0) Color.WHITE else dim).apply { setTypeface(null, Typeface.BOLD) }, LinearLayout.LayoutParams(dp(48), -2))
                line.addView(label(if (state.counts == null) "" else "$total ${if (total == 1) section.removeSuffix("s") else section}", 13f), LinearLayout.LayoutParams(0, -2, 1f))
                line.addView(label(if (open) "−" else "+", 24f, if (total > 0) mint else dim))
                container.addView(line)
                container.alpha = if (state.counts != null && total == 0) 0.45f else 1f
                container.contentDescription = "${if (open) "Collapse" else "Expand"} $section ${if (letter == "#") "special characters" else letter}"
                if (total > 0) container.setOnClickListener { toggle(letter) }
            } else {
                container.alpha = 1f
                val busy = jobs[letter]?.isActive == true
                val error = errors[letter]
                container.addView(label(when { busy -> "Loading $section…"; error != null -> "$error · Tap to retry"; else -> "Load more $section" }, color = if (busy) dim else mint))
                container.contentDescription = "${if (error != null) "Retry" else "Load more"} $section $letter"
                if (!busy) container.setOnClickListener { loadPage(letter) }
                // More pages are fetched when their placeholder enters the viewport.
                if (!busy && error == null) post { if (isAttachedToWindow && letter in state.expanded) loadPage(letter) }
            }
        }
        override fun onViewRecycled(holder: Holder) {
            holder.container.alpha = 1f
            super.onViewRecycled(holder)
        }
    }
    init {
        layoutManager = LinearLayoutManager(context); adapter = libraryAdapter
        clipToPadding = false; setPadding(dp(16), 0, dp(16), dp(20))
        rebuild()
        refreshIndex()
    }
    fun search(query: String) {
        if (query == state.query) return
        generation++; indexJob?.cancel(); jobs.values.forEach { it.cancel() }; jobs.clear(); errors.clear()
        state.query = query; state.counts = null; state.expanded.clear(); state.entries.clear(); state.complete.clear(); state.scroll = null; pendingScroll = null
        refreshIndex(); scrollToPosition(0)
    }
    fun changeView() {
        saveScroll(); pendingScroll = state.scroll
        rebuild()
    }
    fun chooseLetter() {
        // Keep the keyboard from reclaiming focus and scrolling back to the search
        // field after the chosen letter has been brought into view.
        header.isFocusableInTouchMode = true; header.requestFocus()
        (context.getSystemService(Context.INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager)
            .hideSoftInputFromWindow(windowToken, 0)
        if (loadingIndex || state.counts == null) { pendingPicker = true; return }
        pendingPicker = false
        val dialog = android.app.Dialog(context)
        val panel = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(16), dp(16), dp(24))
            background = android.graphics.drawable.GradientDrawable().apply { setColor(Color.rgb(29, 32, 38)); cornerRadius = dp(24).toFloat() }
        }
        panel.addView(label("Jump to $section", 21f, Color.WHITE))
        val grid = android.widget.GridLayout(context).apply { columnCount = 6 }
        LibraryLetters.keys.forEach { letter ->
            val available = (state.counts?.get(letter) ?: 0) > 0
            grid.addView(label(letter, 20f, if (available) mint else dim).apply {
                gravity = Gravity.CENTER; alpha = if (available) 1f else 0.3f
                contentDescription = "Jump to $section ${if (letter == "#") "special characters" else letter}"
                if (available) setOnClickListener {
                    dialog.dismiss()
                    if (letter !in state.expanded) toggle(letter)
                    val position = rows.indexOfFirst { it.key == "letter:$letter" }
                    if (position >= 0) (layoutManager as LinearLayoutManager).scrollToPositionWithOffset(position, 0)
                }
            }, android.widget.GridLayout.LayoutParams().apply { width = 0; height = dp(52); columnSpec = android.widget.GridLayout.spec(android.widget.GridLayout.UNDEFINED, 1f) })
        }
        panel.addView(grid)
        panel.addView(label("Close", color = mint).apply { gravity = Gravity.CENTER; setOnClickListener { dialog.dismiss() } })
        dialog.setContentView(panel); dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        dialog.window?.setGravity(Gravity.BOTTOM); dialog.show(); dialog.window?.setLayout(-1, -2)
    }
    private fun toggle(letter: String) {
        if (!state.expanded.add(letter)) {
            state.expanded.remove(letter); jobs.remove(letter)?.cancel(); errors.remove(letter)
        }
        rebuild()
        if (letter in state.expanded && state.entries[letter].isNullOrEmpty()) loadPage(letter)
    }
    private fun refreshIndex() {
        indexJob?.cancel(); loadingIndex = true; indexError = null
        rebuild()
        val request = generation
        indexJob = pageScope.launch {
            try {
                val raw = api.call("library/$section?group_by=initial&q=${Api.encode(state.query)}")
                val response = org.json.JSONTokener(raw).nextValue() as? JSONObject ?: error("Update the Rust API to enable letter browsing")
                check(response.optString("grouping") == "initial") { "Update the Rust API to enable letter browsing" }
                val groups = response.getJSONArray("groups")
                val counts = (0 until groups.length()).associate { index -> groups.getJSONObject(index).let { it.getString("initial") to it.getInt("count") } }
                if (request != generation) return@launch
                state.entries.keys.toList().forEach { letter ->
                    if (state.counts?.get(letter) != counts[letter]) { state.entries.remove(letter); state.complete.remove(letter) }
                }
                state.counts = counts; loadingIndex = false; rebuild()
                state.expanded.toList().filter { (counts[it] ?: 0) > 0 && state.entries[it].isNullOrEmpty() }.forEach(::loadPage)
                if (pendingPicker && isAttachedToWindow) post { if (isAttachedToWindow) chooseLetter() }
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                if (request == generation) { loadingIndex = false; pendingPicker = false; indexError = e.message ?: "Could not load letters"; rebuild() }
            }
        }
    }
    private fun loadPage(letter: String) {
        if (loadingIndex || letter !in state.expanded || jobs[letter]?.isActive == true || letter in state.complete || (state.counts?.get(letter) ?: 0) == 0) return
        errors.remove(letter)
        val request = generation
        val offset = state.entries[letter]?.size ?: 0
        // Lazy start makes the loading marker visible before the request can complete.
        val job = pageScope.launch(start = CoroutineStart.LAZY) {
            try {
                val values = api.array("library/$section?initial=${Api.encode(letter)}&q=${Api.encode(state.query)}&limit=$pageSize&offset=$offset")
                if (request != generation) return@launch
                val page = (0 until values.length()).map { mapEntry(values.getJSONObject(it)) }
                check(page.all { LibraryLetters.initial(it.title) == letter }) { "Update the Rust API to enable letter browsing" }
                state.entries[letter] = state.entries[letter].orEmpty() + page
                if (page.size < pageSize || state.entries[letter].orEmpty().size >= (state.counts?.get(letter) ?: 0)) state.complete.add(letter)
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                if (request == generation) errors[letter] = e.message ?: "Could not load $section"
            } finally {
                if (request == generation && jobs[letter] == coroutineContext[Job]) { jobs.remove(letter); if (isAttachedToWindow) rebuild() }
            }
        }
        jobs[letter] = job; job.start(); rebuild()
    }
    private fun rebuild() {
        val old = rows
        rows = buildList {
            add(Row("header"))
            if (loadingIndex && state.counts == null || indexError != null || state.counts?.values?.sum() == 0) add(Row("index", status = "$loadingIndex:$indexError"))
            LibraryLetters.keys.filter { state.query.isBlank() || state.counts == null || (state.counts?.get(it) ?: 0) > 0 }.forEach { letter ->
                add(Row("letter:$letter", letter, status = "${state.counts?.get(letter)}:${letter in state.expanded}"))
                if (letter in state.expanded && (state.counts?.get(letter) ?: 0) > 0) {
                    state.entries[letter].orEmpty().chunked(if (viewMode() == "Tiles") 2 else 1).forEachIndexed { index, entries -> add(Row("$letter:$index", letter, entries, status = viewMode())) }
                    if (letter !in state.complete) add(Row("more:$letter", letter, status = "${jobs[letter]?.isActive}:${errors[letter]}"))
                }
            }
        }
        DiffUtil.calculateDiff(object : DiffUtil.Callback() {
            override fun getOldListSize() = old.size
            override fun getNewListSize() = rows.size
            override fun areItemsTheSame(oldItemPosition: Int, newItemPosition: Int) = old[oldItemPosition].key == rows[newItemPosition].key
            override fun areContentsTheSame(oldItemPosition: Int, newItemPosition: Int) = old[oldItemPosition] == rows[newItemPosition]
        }).dispatchUpdatesTo(libraryAdapter)
        pendingScroll?.let { layoutManager?.onRestoreInstanceState(it); pendingScroll = null }
    }
    private fun saveScroll() { state.scroll = layoutManager?.onSaveInstanceState() }
    override fun onDetachedFromWindow() { saveScroll(); super.onDetachedFromWindow() }
}
