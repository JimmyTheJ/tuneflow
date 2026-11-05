package dev.tuneflow

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.BitmapFactory
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.*
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.*
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import android.widget.*
import androidx.media3.common.*
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.HttpDataSource
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executor

/** Native Android Views; the service owns playback independently of this screen. */
@UnstableApi
class MainActivity : Activity() {
    private data class BrowseGroup(val id: String, val title: String, val subtitle: String, val detail: String, val artwork: String = "")
    private lateinit var session: Session
    private lateinit var api: Api
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var screenJob: Job? = null
    private var controller: MediaController? = null
    private var controllerFuture: com.google.common.util.concurrent.ListenableFuture<MediaController>? = null
    private var user = JSONObject()
    private lateinit var root: LinearLayout
    private lateinit var content: LinearLayout
    private lateinit var footer: LinearLayout
    private lateinit var titleView: TextView
    private var progress: SeekBar? = null
    private var transport: TextView? = null
    private var playingTitle: TextView? = null
    private var miniArtwork: ImageView? = null
    private var shownArtwork = ""
    private var playerSheet: android.app.Dialog? = null
    private var sheetProgress: SeekBar? = null
    private var sheetTransport: Button? = null
    private var sheetTitle: TextView? = null
    private var sheetArtist: TextView? = null
    private var sheetArtwork: ImageView? = null
    private var sheetElapsed: TextView? = null
    private var sheetDuration: TextView? = null
    private var navigationEnabled = false
    private var playGeneration = 0L
    private var tab = "Home"
    private var pageOffset = 0
    private var backAction: (() -> Unit)? = null
    private val browseQueries = mutableMapOf<String, String>()
    private val browseOffsets = mutableMapOf<String, Int>()
    private val artistAlbumFilters = mutableMapOf<String, String>()
    private val artistAlbumOffsets = mutableMapOf<String, Int>()
    private val artistSongOffsets = mutableMapOf<String, Int>()
    private val artistSummaries = mutableMapOf<String, Pair<Int, Int>>()
    private val tick = Handler(Looper.getMainLooper())
    private val background = Color.rgb(12, 14, 18)
    private val surface = Color.rgb(29, 32, 38)
    private val mint = Color.rgb(80, 216, 143)
    private val secondary = Color.rgb(166, 171, 180)
    private val pulse = object : Runnable {
        override fun run() { updatePlayer(); tick.postDelayed(this, 500) }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        session = Session(this); api = Api(session)
        window.decorView.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                if (::footer.isInitialized) footer.visibility = if (insets.isVisible(WindowInsets.Type.ime())) View.GONE else View.VISIBLE
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 10)
        if (Build.VERSION.SDK_INT >= 33) onBackInvokedDispatcher.registerOnBackInvokedCallback(
            OnBackInvokedDispatcher.PRIORITY_DEFAULT, OnBackInvokedCallback { navigateBack() })
        if (session.token.isEmpty()) loginScreen() else restore()
        tick.post(pulse)
    }
    private fun restore() {
        navigationEnabled = false; frame("Connecting")
        scope.launch {
            try { user = api.obj("auth/me"); connectPlayer(); home() }
            catch (e: Exception) {
                if (e is ApiException && e.status == 401) { session.clear(); loginScreen() }
                else { content.removeAllViews(); label(e.message ?: "Server unavailable"); action("Retry") { restore() }; action("Server settings") { loginScreen() } }
            }
        }
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    private fun box(padding: Int = 16) = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; setPadding(dp(padding), dp(padding), dp(padding), dp(padding))
    }
    private fun frame(title: String, detail: Boolean = false) {
        root = box(0); root.setBackgroundColor(background)
        val heading = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(16), dp(8), dp(12), dp(4)) }
        if (detail) heading.addView(iconButton("‹", "Back") { backAction?.invoke() }, LinearLayout.LayoutParams(dp(42), dp(48)))
        titleView = TextView(this).apply { text = title; textSize = 26f; setTextColor(Color.WHITE); setTypeface(null, Typeface.BOLD); maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END }
        heading.addView(titleView, LinearLayout.LayoutParams(0, dp(52), 1f))
        if (navigationEnabled && (detail || tab != "Home")) heading.addView(iconButton("⌂", "Go home") { tab = "Home"; home() }, LinearLayout.LayoutParams(dp(48), dp(48)))
        root.addView(heading)
        val scroll = ScrollView(this).apply { isFillViewport = true }
        content = box(16); scroll.addView(content)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        footer = box(0); root.addView(footer)
        if (navigationEnabled) { playerFooter(); navigationBar() }
        setContentView(root)
        updatePlayer()
    }
    private fun rounded(color: Int = surface, radius: Int = 14) = GradientDrawable().apply { setColor(color); cornerRadius = dp(radius).toFloat() }
    private fun iconButton(symbol: String, description: String, run: () -> Unit) = TextView(this).apply {
        text = symbol; contentDescription = description; textSize = 27f; gravity = Gravity.CENTER; setTextColor(Color.WHITE); setOnClickListener { run() }
    }
    private fun text(value: String, size: Float = 16f, color: Int = Color.WHITE) = TextView(this).apply {
        text = value; textSize = size; setTextColor(color); setPadding(0, dp(5), 0, dp(5))
    }
    private fun label(value: String, target: LinearLayout = content) { target.addView(text(value, 15f, secondary)) }
    private fun action(value: String, target: LinearLayout = content, run: () -> Unit): Button = Button(this).apply {
        text = value; isAllCaps = false; setTextColor(Color.WHITE); textSize = 15f; gravity = Gravity.CENTER_VERTICAL or Gravity.START
        setPadding(dp(16), 0, dp(12), 0); background = rounded(); setOnClickListener { run() }
        target.addView(this, LinearLayout.LayoutParams(-1, dp(52)).apply { bottomMargin = dp(8) })
    }
    private fun input(hint: String, initial: String = "", secret: Boolean = false, target: LinearLayout = content) = EditText(this).apply {
        this.hint = hint; setText(initial); setTextColor(Color.WHITE); setHintTextColor(secondary); isSingleLine = true
        if (secret) inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        background = rounded(); setPadding(dp(16), 0, dp(16), 0)
        target.addView(this, LinearLayout.LayoutParams(-1, dp(52)).apply { bottomMargin = dp(10) })
    }
    private fun debounce(field: EditText, run: () -> Unit) {
        val handler = Handler(Looper.getMainLooper())
        var pending: Runnable? = null
        field.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                pending?.let(handler::removeCallbacks)
                pending = Runnable { if (field.isAttachedToWindow) run() }
                handler.postDelayed(pending!!, 300)
            }
            override fun afterTextChanged(s: Editable?) {}
        })
        field.setOnEditorActionListener { _, _, _ -> pending?.let(handler::removeCallbacks); run(); field.clearFocus(); true }
    }
    private fun launchWork(block: suspend () -> Unit) { scope.launch { try { block() } catch (e: CancellationException) { throw e } catch (e: Exception) { showError(e) } } }
    private fun showError(e: Exception) { AlertDialog.Builder(this).setTitle("Tuneflow").setMessage(e.message ?: "Request failed").setPositiveButton("OK", null).show() }
    private fun loginScreen() {
        screenJob?.cancel(); navigationEnabled = false; frame("Tuneflow")
        label("Your music. Your household.")
        val server = input("Tuneflow server URL", session.server)
        val household = input("Household", session.household)
        val username = input("Username")
        val password = input("Password", secret = true)
        action("Sign in") {
            launchWork {
                session.server = server.text.toString(); session.household = household.text.toString().trim().lowercase()
                val response = api.obj("auth/login", "POST", JSONObject().put("household_slug", session.household).put("username", username.text.toString()).put("password", password.text.toString()), false)
                acceptSession(response)
            }
        }
        action("Set up a new server") {
            session.server = server.text.toString()
            launchWork {
                val status = api.obj("auth/setup-status", authenticated = false)
                if (!status.optBoolean("needs_setup")) throw IllegalStateException("This server is already set up. Sign in with your household.")
                val form = box(); val name = input("Display name", target = form)
                AlertDialog.Builder(this@MainActivity).setTitle("Create administrator").setView(form)
                    .setPositiveButton("Create") { _, _ -> launchWork {
                        val response = api.obj("auth/setup", "POST", JSONObject().put("username", username.text.toString()).put("password", password.text.toString()).put("display_name", name.text.toString()), false)
                        session.household = "system"; acceptSession(response)
                    } }.setNegativeButton("Cancel", null).show()
            }
        }
    }
    private fun acceptSession(response: JSONObject) {
        controller?.stop(); controller?.clearMediaItems()
        controllerFuture?.let { MediaController.releaseFuture(it) }; controllerFuture = null; controller = null
        stopService(android.content.Intent(this, PlaybackService::class.java))
        session.token = response.getString("access_token"); user = response.getJSONObject("user"); session.userId = user.getLong("id").toString()
        connectPlayer(); home()
    }
    private fun connectPlayer() {
        if (controllerFuture != null) return
        val future = MediaController.Builder(this, SessionToken(this, ComponentName(this, PlaybackService::class.java))).buildAsync()
        controllerFuture = future
        future.addListener({
            runCatching { controller = future.get(); updatePlayer() }.onFailure { showError(Exception("Could not connect to playback service", it)) }
        }, Executor { runOnUiThread(it) })
    }
    private fun home() {
        screenJob?.cancel(); pageOffset = 0; backAction = null; navigationEnabled = true; frame(tab)
        when (tab) {
            "Home" -> dashboard()
            "Library" -> libraryHub()
            "Search" -> libraryOrDiscovery()
            "Settings" -> settings()
            "Playlists" -> playlists()
            "Albums" -> albums()
            "Artists" -> artists()
            else -> libraryOrDiscovery()
        }
    }
    private fun navigationBar() {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER; setPadding(dp(4), dp(6), dp(4), dp(4)) }
        for ((name, symbol) in listOf("Home" to "⌂", "Search" to "⌕", "Library" to "▥", "YouTube" to "▶", "Settings" to "⚙")) {
            val selected = tab == name || (name == "Library" && tab in listOf("Artists", "Albums", "Playlists"))
            val button = box(0).apply { gravity = Gravity.CENTER; background = if (selected) rounded(Color.rgb(31, 50, 39), 12) else null }
            button.addView(text(symbol, 21f, if (selected) mint else secondary).apply { gravity = Gravity.CENTER; setPadding(0, 0, 0, 0) })
            button.addView(text(name, 10f, if (selected) mint else secondary).apply { gravity = Gravity.CENTER; setPadding(0, 0, 0, 0) })
            button.contentDescription = name; button.setOnClickListener { tab = name; home() }
            row.addView(button, LinearLayout.LayoutParams(0, dp(54), 1f))
        }
        footer.addView(row)
    }
    private fun dashboard() {
        label("Your music, ready when you are")
        action("⌕   Search your library") { tab = "Search"; home() }
        action("▥   Browse artists") { tab = "Artists"; home() }
        action("▦   Browse albums") { tab = "Albums"; home() }
        action("☷   Playlists and likes") { tab = "Playlists"; home() }
        action("▶   Discover on YouTube") { tab = "YouTube"; home() }
    }
    private fun libraryHub() {
        label("Browse your Jellyfin collection")
        action("Artists") { tab = "Artists"; home() }
        action("Albums") { tab = "Albums"; home() }
        action("Songs") { tab = "Search"; home() }
        action("Playlists and likes") { tab = "Playlists"; home() }
    }
    // Android 13+ uses the platform gesture callback registered in onCreate.
    @SuppressLint("GestureBackNavigation")
    @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
    override fun onBackPressed() {
        navigateBack()
    }
    private fun navigateBack() {
        when {
            backAction != null -> backAction?.invoke()
            navigationEnabled && tab != "Home" -> { tab = "Home"; home() }
            else -> finish()
        }
    }
    private fun playerFooter() {
        shownArtwork = ""
        val card = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(8), dp(6), dp(4), dp(6)); background = rounded(Color.rgb(40, 48, 43), 12) }
        card.setOnClickListener { nowPlaying() }
        miniArtwork = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP; background = rounded(Color.rgb(56, 65, 59), 8) }
        card.addView(miniArtwork, LinearLayout.LayoutParams(dp(44), dp(44)))
        playingTitle = text("Choose something to play", 13f).apply { maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END; setPadding(dp(10), 0, dp(4), 0) }
        card.addView(playingTitle, LinearLayout.LayoutParams(0, -2, 1f))
        transport = iconButton("▶", "Play or pause") { togglePlayback() }.also { card.addView(it, LinearLayout.LayoutParams(dp(44), dp(48))) }
        // The compact player opens from its artwork or text; transport remains a direct control.
        miniArtwork?.setOnClickListener { nowPlaying() }
        playingTitle?.setOnClickListener { nowPlaying() }
        footer.addView(card, LinearLayout.LayoutParams(-1, dp(58)).apply { leftMargin = dp(8); rightMargin = dp(8) })
        progress = SeekBar(this).also { slider ->
            slider.max = 1000; slider.setPadding(dp(8), 0, dp(8), 0)
            slider.setOnSeekBarChangeListener(seekListener())
            footer.addView(slider, LinearLayout.LayoutParams(-1, dp(14)))
        }
    }
    private fun seekListener() = object : SeekBar.OnSeekBarChangeListener {
        override fun onProgressChanged(seekBar: SeekBar, value: Int, fromUser: Boolean) { if (fromUser) controller?.let { if (it.duration > 0) it.seekTo(it.duration * value / 1000) } }
        override fun onStartTrackingTouch(seekBar: SeekBar) {}
        override fun onStopTrackingTouch(seekBar: SeekBar) {}
    }
    private fun togglePlayback() { controller?.let { if (it.playerError != null) it.prepare(); if (it.isPlaying) it.pause() else it.play() } }
    private fun formatTime(ms: Long) = if (ms <= 0) "0:00" else "${ms / 60000}:${((ms / 1000) % 60).toString().padStart(2, '0')}"
    private fun loadArtwork(view: ImageView?, url: String?) {
        if (view == null) return
        val address = url.orEmpty()
        view.tag = address
        view.setImageDrawable(null)
        if (address.isBlank()) { view.setImageResource(R.drawable.ic_music); return }
        scope.launch {
            val bitmap = withContext(Dispatchers.IO) { runCatching {
                val conn = java.net.URL(address).openConnection().apply { connectTimeout = 5000; readTimeout = 5000 }
                conn.getInputStream().use { BitmapFactory.decodeStream(it) }
            }.getOrNull() }
            if (view.tag == address) {
                if (bitmap == null) view.setImageResource(R.drawable.ic_music) else view.setImageBitmap(bitmap)
            }
        }
    }
    private fun updatePlayer() {
        val p = controller ?: return
        val item = p.currentMediaItem
        playingTitle?.text = when {
            p.playerError != null -> playbackErrorMessage(p.playerError!!)
            item == null -> "Choose something to play"
            p.playbackState == Player.STATE_BUFFERING -> "Loading · ${item.mediaMetadata.title}"
            else -> "${item.mediaMetadata.title} · ${item.mediaMetadata.artist ?: ""}"
        }
        transport?.text = if (p.isPlaying) "Ⅱ" else "▶"
        sheetTransport?.text = if (p.isPlaying) "Ⅱ" else "▶"
        sheetTitle?.text = item?.mediaMetadata?.title ?: "Nothing playing"
        sheetArtist?.text = item?.mediaMetadata?.artist ?: ""
        sheetElapsed?.text = formatTime(p.currentPosition)
        sheetDuration?.text = formatTime(p.duration)
        val artwork = item?.mediaMetadata?.artworkUri?.toString().orEmpty()
        if (shownArtwork != artwork) { shownArtwork = artwork; loadArtwork(miniArtwork, artwork); loadArtwork(sheetArtwork, artwork) }
        if (p.duration > 0 && progress?.isPressed != true) progress?.progress = (p.currentPosition * 1000 / p.duration).toInt()
        if (p.duration > 0 && sheetProgress?.isPressed != true) sheetProgress?.progress = (p.currentPosition * 1000 / p.duration).toInt()
    }
    private fun nowPlaying() {
        if (controller?.currentMediaItem == null) { Toast.makeText(this, "Choose a track first", Toast.LENGTH_SHORT).show(); return }
        val dialog = android.app.Dialog(this)
        val panel = box(20).apply { background = rounded(Color.rgb(25, 29, 34), 24) }
        val handle = text("━━", 19f, secondary).apply { gravity = Gravity.CENTER; setPadding(0, 0, 0, dp(8)) }
        panel.addView(handle)
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        top.addView(text("Now playing", 17f).apply { setTypeface(null, Typeface.BOLD) }, LinearLayout.LayoutParams(0, -2, 1f))
        top.addView(iconButton("⌄", "Collapse player") { dialog.dismiss() }, LinearLayout.LayoutParams(dp(46), dp(46)))
        panel.addView(top)
        sheetArtwork = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP; background = rounded(Color.rgb(55, 59, 63), 16) }
        panel.addView(sheetArtwork, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = dp(22); bottomMargin = dp(22) })
        sheetTitle = text("", 24f).apply { setTypeface(null, Typeface.BOLD); maxLines = 2 }
        sheetArtist = text("", 16f, secondary)
        panel.addView(sheetTitle); panel.addView(sheetArtist)
        sheetProgress = SeekBar(this).apply { max = 1000; setOnSeekBarChangeListener(seekListener()) }
        panel.addView(sheetProgress)
        val times = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        sheetElapsed = text("0:00", 12f, secondary); sheetDuration = text("0:00", 12f, secondary)
        times.addView(sheetElapsed, LinearLayout.LayoutParams(0, -2, 1f)); times.addView(sheetDuration)
        panel.addView(times)
        val controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        controls.addView(iconButton("|◀", "Previous track") { controller?.seekToPreviousMediaItem() }, LinearLayout.LayoutParams(0, dp(64), 1f))
        sheetTransport = Button(this).apply { isAllCaps = false; setTextColor(Color.BLACK); background = rounded(mint, 40); setOnClickListener { togglePlayback() } }
        controls.addView(sheetTransport, LinearLayout.LayoutParams(dp(72), dp(64)))
        controls.addView(iconButton("▶|", "Next track") { controller?.seekToNextMediaItem() }, LinearLayout.LayoutParams(0, dp(64), 1f))
        panel.addView(controls)
        action("☷   Manage queue", panel) { queue() }
        var downY = 0f
        handle.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downY = event.rawY; true }
                MotionEvent.ACTION_UP -> { if (event.rawY - downY > dp(70)) dialog.dismiss(); true }
                else -> true
            }
        }
        dialog.setContentView(panel)
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        dialog.window?.setLayout(-1, -1)
        dialog.window?.setGravity(Gravity.BOTTOM)
        dialog.window?.attributes?.windowAnimations = R.style.PlayerSheetAnimation
        dialog.setOnDismissListener { playerSheet = null; sheetProgress = null; sheetTransport = null; sheetTitle = null; sheetArtist = null; sheetArtwork = null; sheetElapsed = null; sheetDuration = null }
        playerSheet = dialog
        dialog.show()
        dialog.window?.setLayout(-1, (resources.displayMetrics.heightPixels * 0.88f).toInt())
        loadArtwork(sheetArtwork, controller?.currentMediaItem?.mediaMetadata?.artworkUri?.toString())
        updatePlayer()
    }
    private fun playbackErrorMessage(error: PlaybackException): String {
        val response = generateSequence<Throwable>(error) { it.cause }
            .filterIsInstance<HttpDataSource.InvalidResponseCodeException>().firstOrNull()
        if (response != null) {
            val detail = runCatching { JSONObject(String(response.responseBody)).optString("detail") }.getOrDefault("")
            return "Playback failed (HTTP ${response.responseCode})${if (detail.isNotBlank()) " · $detail" else ""}"
        }
        return "Playback failed (${error.errorCodeName}) · tap Play to retry"
    }
    private fun libraryOrDiscovery() {
        val discovery = tab == "YouTube"
        label(if (discovery) "Supplement your library with YouTube discovery." else "Fast playback from your Jellyfin collection.")
        val query = input(if (discovery) "Search YouTube" else "Search your library")
        val results = box(0); content.addView(results)
        val songList = box(0)
        var displayedTracks = listOf<Track>()
        lateinit var load: (String, Int) -> Unit
        load = { value, offset ->
            screenJob?.cancel(); results.removeAllViews(); results.addView(text("Loading…", color = secondary))
            screenJob = scope.launch {
                try {
                    val tracks = if (discovery) {
                        val r = api.obj("music/search?source=youtube&q=${Api.encode(value)}&limit=25")
                        r.getJSONArray("groups").objects().map { Track.from(it.getJSONObject("primary")) }
                    } else api.array("library/tracks?q=${Api.encode(value)}&limit=100&offset=$offset").objects().map(Track::from)
                    results.removeAllViews(); displayedTracks = tracks
                    if (tracks.isEmpty()) {
                        results.addView(text(if (discovery) "No matches found" else "No tracks found. Link Jellyfin and sync your library in Settings.", color = secondary))
                    }
                    if (tracks.isNotEmpty()) {
                        action("Play all", results) { play(tracks, 0) }
                        results.addView(songList); renderTracks(songList, tracks, "songs")
                    }
                    if (!discovery) {
                        if (offset > 0) action("Previous page", results) { pageOffset = (offset - 100).coerceAtLeast(0); load(value, pageOffset) }
                        if (tracks.size == 100) action("Next page", results) { pageOffset = offset + 100; load(value, pageOffset) }
                    }
                } catch (e: CancellationException) { throw e } catch (e: Exception) {
                    results.removeAllViews(); results.addView(text(e.message ?: "Could not load music", color = secondary))
                }
            }
        }
        val picker = box(0); content.addView(picker, content.indexOfChild(results))
        viewPicker("songs", picker) { renderTracks(songList, displayedTracks, "songs") }
        debounce(query) {
            val value = query.text.toString().trim(); pageOffset = 0
            if (!discovery || value.isNotEmpty()) load(value, 0) else { screenJob?.cancel(); results.removeAllViews(); label("Type to search YouTube", results) }
        }
        if (!discovery) load("", 0)
    }
    private fun trackRow(target: LinearLayout, track: Track, title: String = track.title,
                         subtitle: String = track.artist, details: Boolean = false, onPlay: () -> Unit) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(8), dp(if (details) 9 else 5), dp(4), dp(if (details) 9 else 5))
            background = rounded()
        }
        val artwork = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP; background = rounded(Color.rgb(55, 59, 63), 8) }
        row.addView(artwork, LinearLayout.LayoutParams(dp(if (details) 54 else 42), dp(if (details) 54 else 42)))
        loadArtwork(artwork, track.artwork.takeIf { it.isNotBlank() }?.let { if (it.startsWith('/')) session.server + it else it })
        val labels = box(0).apply { setPadding(dp(10), 0, 0, 0) }
        labels.addView(text(title, if (details) 16f else 15f).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END; setPadding(0, 0, 0, 0) })
        labels.addView(text(if (track.blocked.isEmpty()) subtitle else track.blocked, 12f, secondary).apply { maxLines = if (details) 2 else 1; ellipsize = android.text.TextUtils.TruncateAt.END; setPadding(0, 0, 0, 0) })
        row.addView(labels, LinearLayout.LayoutParams(0, -2, 1f)); labels.setOnClickListener { if (track.blocked.isEmpty()) onPlay() }
        row.addView(iconButton("⋮", "Options for ${track.title}") { trackMenu(track) }.apply { setTextColor(secondary); textSize = 22f }, LinearLayout.LayoutParams(dp(38), dp(44)))
        target.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(5) })
    }
    private fun item(track: Track, stream: JSONObject? = null): MediaItem {
        val artworkPath = track.artwork
        val artwork = artworkPath.takeIf { it.isNotEmpty() }?.let { Uri.parse(if (it.startsWith('/')) session.server + it else it) }
        val path = stream?.optString("audio_url").orEmpty()
        val url = when {
            path.startsWith('/') -> session.server + path
            path.startsWith("https://") || path.startsWith("http://") -> path
            else -> "${session.server}/api/music/audio/${Api.encode(track.id)}"
        }
        val builder = MediaItem.Builder().setMediaId(track.id).setUri(url)
            .setCustomCacheKey("${session.server}|${session.userId}|${track.id}")
            .setMediaMetadata(MediaMetadata.Builder().setTitle(track.title).setArtist(track.artist).setArtworkUri(artwork).build())
        stream?.optString("mime_type")?.takeIf { it.isNotBlank() && it != "null" }?.let(builder::setMimeType)
        return builder.build()
    }
    private fun play(tracks: List<Track>, start: Int, ordered: Boolean = false) {
        val player = controller ?: run { showError(Exception("Player is connecting; try again")); return }
        val selected = tracks[start]
        if (selected.blocked.isNotEmpty()) { showError(Exception(selected.blocked)); return }
        val playable = tracks.filter { it.blocked.isEmpty() }
        val generation = ++playGeneration
        fun startPlayback(stream: JSONObject?) {
            if (generation != playGeneration) return
            if (ordered) player.shuffleModeEnabled = false
            player.setMediaItems(playable.map { item(it, if (it.id == selected.id) stream else null) }, playable.indexOf(selected).coerceAtLeast(0), 0)
            player.prepare(); player.play()
        }
        if (selected.id.startsWith("jf_")) startPlayback(null)
        else {
            playingTitle?.text = "Preparing YouTube audio · ${selected.title}"
            scope.launch { try {
                val stream = api.obj("music/stream/${Api.encode(selected.id)}")
                startPlayback(stream)
            } catch (e: CancellationException) { throw e } catch (e: Exception) {
                if (generation == playGeneration) {
                    playingTitle?.text = "YouTube audio unavailable · ${selected.title}"
                    showError(Exception("YouTube playback could not start: ${e.message ?: "Server error"}", e))
                }
            } }
        }
    }
    private fun trackMenu(track: Track) {
        AlertDialog.Builder(this).setTitle(track.title).setItems(arrayOf("Play next", "Add to queue", "Like", "Add to playlist")) { _, choice ->
            when (choice) {
                0 -> controller?.let { it.addMediaItem(it.currentMediaItemIndex + 1, item(track)) }
                1 -> controller?.addMediaItem(item(track))
                2 -> launchWork { api.call("likes", "POST", track.json()); Toast.makeText(this@MainActivity, "Liked", Toast.LENGTH_SHORT).show() }
                3 -> launchWork {
                    val playlists = api.array("playlists").objects()
                    AlertDialog.Builder(this@MainActivity).setTitle("Add to playlist").setItems(playlists.map { it.optString("name") }.toTypedArray()) { _, index ->
                        launchWork { api.call("playlists/${playlists[index].getLong("id")}/tracks", "POST", track.json()); Toast.makeText(this@MainActivity, "Added", Toast.LENGTH_SHORT).show() }
                    }.show()
                }
            }
        }.show()
    }
    private fun queue() {
        val p = controller ?: return
        val view = box(12)
        val options = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val shuffle = CheckBox(this).apply { text = "Shuffle"; isChecked = p.shuffleModeEnabled; setOnCheckedChangeListener { _, checked -> p.shuffleModeEnabled = checked } }
        options.addView(shuffle, LinearLayout.LayoutParams(0, -2, 1f))
        val repeat = Button(this).apply { isAllCaps = false; setTextColor(mint) }
        fun repeatLabel() { repeat.text = "Repeat: ${when(p.repeatMode) { Player.REPEAT_MODE_ALL -> "All"; Player.REPEAT_MODE_ONE -> "One"; else -> "Off" }}" }
        repeatLabel()
        repeat.setOnClickListener { p.repeatMode = when(p.repeatMode) { Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL; Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE; else -> Player.REPEAT_MODE_OFF }; repeatLabel() }
        options.addView(repeat, LinearLayout.LayoutParams(0, -2, 1f)); view.addView(options)
        val scroll = ScrollView(this); val rows = box(0); scroll.addView(rows)
        view.addView(scroll, LinearLayout.LayoutParams(-1, dp(440)))
        fun refresh() {
            rows.removeAllViews()
            if (p.mediaItemCount == 0) label("Your queue is empty", rows)
            for (i in 0 until p.mediaItemCount) {
                val media = p.getMediaItemAt(i)
                val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; background = rounded(if (i == p.currentMediaItemIndex) Color.rgb(38, 64, 48) else surface, 10) }
                val title = text("${if (i == p.currentMediaItemIndex) "▶  " else ""}${media.mediaMetadata.title}\n${media.mediaMetadata.artist ?: ""}", 14f).apply { maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END; setPadding(dp(10), dp(7), dp(3), dp(7)); setOnClickListener { p.seekToDefaultPosition(i); p.play(); refresh() } }
                row.addView(title, LinearLayout.LayoutParams(0, -2, 1f))
                fun queueButton(symbol: String, description: String, enabled: Boolean, run: () -> Unit) {
                    row.addView(iconButton(symbol, description) { if (enabled) run() }.apply { alpha = if (enabled) 1f else 0.35f; textSize = 22f }, LinearLayout.LayoutParams(dp(38), dp(48)))
                }
                queueButton("↑", "Move ${media.mediaMetadata.title} earlier", i > 0) { p.moveMediaItem(i, i - 1); refresh() }
                queueButton("↓", "Move ${media.mediaMetadata.title} later", i < p.mediaItemCount - 1) { p.moveMediaItem(i, i + 1); refresh() }
                queueButton("×", "Remove ${media.mediaMetadata.title} from queue", true) { p.removeMediaItem(i); refresh() }
                rows.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(6) })
            }
            scroll.layoutParams = (scroll.layoutParams as LinearLayout.LayoutParams).apply {
                height = dp((p.mediaItemCount * 64).coerceIn(100, 440))
            }
        }
        refresh()
        action("Clear queue", view) { p.stop(); p.clearMediaItems(); refresh() }
        AlertDialog.Builder(this).setTitle("Queue · tap a track to play").setView(view).setPositiveButton("Done", null).show()
    }
    private fun viewMode(section: String) = getSharedPreferences("library_views", MODE_PRIVATE).getString(section, "List") ?: "List"
    private fun viewPicker(section: String, target: LinearLayout, onChange: () -> Unit) {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(4), 0, dp(8)) }
        for (mode in listOf("Tiles", "List", "Details")) {
            row.addView(Button(this).apply {
                text = mode; isAllCaps = false; textSize = 12f
                setTextColor(if (viewMode(section) == mode) Color.BLACK else secondary)
                background = rounded(if (viewMode(section) == mode) mint else surface, 18)
                setOnClickListener { getSharedPreferences("library_views", MODE_PRIVATE).edit().putString(section, mode).apply(); viewPickerRefresh(row, section); onChange() }
            }, LinearLayout.LayoutParams(0, dp(36), 1f).apply { marginEnd = dp(6) })
        }
        target.addView(row)
    }
    private fun viewPickerRefresh(row: LinearLayout, section: String) {
        for (i in 0 until row.childCount) {
            val button = row.getChildAt(i) as Button
            val selected = button.text.toString() == viewMode(section)
            button.setTextColor(if (selected) Color.BLACK else secondary)
            button.background = rounded(if (selected) mint else surface, 18)
        }
    }
    private suspend fun allTracks(path: String): List<Track> {
        val found = mutableListOf<Track>()
        for (offset in 0..1_000_000 step 500) {
            val separator = if ('?' in path) '&' else '?'
            val page = api.array("$path${separator}limit=500&offset=$offset").objects().map(Track::from)
            found.addAll(page)
            if (page.size < 500) return found
        }
        throw IllegalStateException("Library is too large to load")
    }
    private fun playGroup(path: String) {
        val request = ++playGeneration
        playingTitle?.text = "Loading queue…"
        launchWork {
            val tracks = allTracks(path)
            if (request != playGeneration) return@launchWork
            if (tracks.isEmpty()) Toast.makeText(this@MainActivity, "No songs to play", Toast.LENGTH_SHORT).show()
            else play(tracks, tracks.indexOfFirst { it.blocked.isEmpty() }.coerceAtLeast(0), ordered = true)
        }
    }
    private fun groupRows(target: LinearLayout, groups: List<BrowseGroup>, section: String, open: (BrowseGroup) -> Unit, playGroup: (BrowseGroup) -> Unit) {
        target.removeAllViews()
        if (viewMode(section) == "Tiles") {
            groups.chunked(2).forEach { pair ->
                val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                pair.forEach { group ->
                    val tile = box(10).apply { background = rounded() }
                    val art = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP; background = rounded(Color.rgb(55, 59, 63), 10) }
                    tile.addView(art, LinearLayout.LayoutParams(-1, dp(112)))
                    loadArtwork(art, group.artwork.takeIf { it.isNotBlank() }?.let { if (it.startsWith('/')) session.server + it else it })
                    tile.addView(text(group.title, 16f))
                    tile.addView(text(group.subtitle, 13f, secondary))
                    tile.setOnClickListener { open(group) }
                    action("▶ Play", tile) { playGroup(group) }
                    row.addView(tile, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(6); bottomMargin = dp(8) })
                }
                target.addView(row)
            }
        } else {
            groups.forEach { group ->
                val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                row.background = rounded(); row.setPadding(dp(8), dp(4), dp(4), dp(4))
                val art = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP; background = rounded(Color.rgb(55, 59, 63), 8) }
                row.addView(art, LinearLayout.LayoutParams(dp(48), dp(48)))
                loadArtwork(art, group.artwork.takeIf { it.isNotBlank() }?.let { if (it.startsWith('/')) session.server + it else it })
                val descriptions = box(0).apply { setPadding(dp(10), 0, 0, 0) }
                descriptions.addView(text(group.title, 15f).apply { maxLines = 1; ellipsize = android.text.TextUtils.TruncateAt.END; setPadding(0, 0, 0, 0) })
                if (viewMode(section) == "Details") descriptions.addView(text(group.detail, 12f, secondary).apply { maxLines = 2; setPadding(0, 0, 0, 0) })
                row.addView(descriptions, LinearLayout.LayoutParams(0, -2, 1f)); descriptions.setOnClickListener { open(group) }; art.setOnClickListener { open(group) }
                row.addView(iconButton("▶", "Play ${group.title}") { playGroup(group) }.apply { textSize = 20f; setTextColor(mint) }, LinearLayout.LayoutParams(dp(44), dp(50)))
                target.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(5) })
            }
        }
    }
    private fun browseGroups(section: String) {
        val artists = section == "artists"
        label(if (artists) "Artists in your Jellyfin library" else "Albums in your Jellyfin library")
        val query = input(if (artists) "Find an artist" else "Find an album", browseQueries[section].orEmpty())
        val rows = box(0)
        val display = box(0)
        var currentGroups = listOf<BrowseGroup>()
        val open: (BrowseGroup) -> Unit = { if (artists) showArtist(it.id) else showAlbum(it.id, it.title, it.subtitle) }
        val playSelected: (BrowseGroup) -> Unit = {
            if (artists) playGroup("library/tracks?artist=${Api.encode(it.id)}") else playGroup("library/tracks?album_id=${Api.encode(it.id)}")
        }
        var offset = browseOffsets[section] ?: 0
        fun load() {
            browseQueries[section] = query.text.toString().trim()
            browseOffsets[section] = offset
            screenJob?.cancel(); rows.removeAllViews(); label("Loading…", rows)
            screenJob = scope.launch { try {
                val path = "library/$section?q=${Api.encode(query.text.toString().trim())}&limit=40&offset=$offset"
                val values = api.array(path).objects()
                if (artists && values.isNotEmpty() && !values[0].has("album_count")) {
                    rows.removeAllViews()
                    label("This server is older than the Android library browser. Update and rebuild the Rust API, then sync Jellyfin again to enable artist search and albums.", rows)
                    return@launch
                }
                currentGroups = values.map { value ->
                    if (artists) {
                        artistSummaries[value.optString("id")] = value.optInt("album_count") to value.optInt("track_count")
                        BrowseGroup(value.optString("id"), value.optString("name"), "${value.optInt("album_count")} albums · ${value.optInt("track_count")} songs", "${value.optInt("album_count")} albums · ${value.optInt("track_count")} songs", value.optString("thumbnail_url"))
                    }
                    else BrowseGroup(value.optString("id"), value.optString("title"), value.optString("artist"), "${value.optString("artist")} · ${value.optInt("track_count")} songs", value.optString("thumbnail_url"))
                }
                rows.removeAllViews()
                if (currentGroups.isEmpty()) label(if (offset == 0) "No ${section} found. Sync Jellyfin in Settings." else "No more ${section}.", rows)
                groupRows(display, currentGroups, section, open, playSelected)
                rows.addView(display)
                if (offset > 0) action("Previous page", rows) { offset = (offset - 40).coerceAtLeast(0); load() }
                if (values.size == 40) action("Next page", rows) { offset += 40; load() }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { rows.removeAllViews(); label(e.message ?: "Could not load library", rows) } }
        }
        debounce(query) { offset = 0; load() }
        viewPicker(section, content) { groupRows(display, currentGroups, section, open, playSelected) }
        content.addView(rows)
        load()
    }
    private fun albums() = browseGroups("albums")
    private fun artists() = browseGroups("artists")
    private fun renderTracks(target: LinearLayout, tracks: List<Track>, section: String, numbered: Boolean = false) {
        target.removeAllViews()
        if (tracks.isEmpty()) { label("No songs found", target); return }
        val mode = viewMode(section)
        if (mode == "Tiles") {
            tracks.chunked(2).forEach { pair ->
                val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                pair.forEach { track ->
                    val tile = box(10).apply { background = rounded() }
                    val art = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP; background = rounded(Color.rgb(55, 59, 63), 10) }
                    tile.addView(art, LinearLayout.LayoutParams(-1, dp(112)))
                    loadArtwork(art, track.artwork.takeIf { it.isNotBlank() }?.let { if (it.startsWith('/')) session.server + it else it })
                    tile.addView(text(track.title, 16f))
                    tile.addView(text(listOf(track.artist, track.album).filter { it.isNotBlank() }.joinToString(" · "), 12f, secondary))
                    tile.setOnClickListener { play(listOf(track), 0) }
                    action("▶ Play", tile) { play(listOf(track), 0) }
                    row.addView(tile, LinearLayout.LayoutParams(0, -2, 1f).apply { marginEnd = dp(6); bottomMargin = dp(8) })
                }
                target.addView(row)
            }
        } else {
            tracks.forEachIndexed { index, track ->
                if (mode == "Details") {
                    val number = if (numbered) "${track.trackNumber ?: index + 1}. " else ""
                    val duration = if (track.duration > 0) " · ${track.duration / 60}:${(track.duration % 60).toString().padStart(2, '0')}" else ""
                    val subtitle = listOf(track.artist, track.album).filter { it.isNotBlank() }.joinToString(" · ") + duration
                    trackRow(target, track, "$number${track.title}", subtitle, details = true) { play(listOf(track), 0) }
                } else {
                    val number = if (numbered) "${track.trackNumber ?: index + 1}. " else ""
                    trackRow(target, track, "$number${track.title}", track.artist) { play(listOf(track), 0) }
                }
            }
        }
    }
    private fun showArtist(name: String) {
        screenJob?.cancel()
        val pageJob = SupervisorJob(scope.coroutineContext[Job])
        screenJob = pageJob
        val pageScope = CoroutineScope(Dispatchers.Main.immediate + pageJob)
        backAction = { home() }; frame(name, detail = true)
        val summary = artistSummaries[name]
        label(if (summary == null) "Library artist" else "${summary.first} albums · ${summary.second} songs")
        action("▶ Play all songs") { playGroup("library/tracks?artist=${Api.encode(name)}") }

        label("Albums")
        val filter = input("Find an album by this artist", artistAlbumFilters[name].orEmpty())
        val albumRows = box(0)
        val albumPaging = box(0)
        var albumOffset = artistAlbumOffsets[name] ?: 0
        var currentAlbums = listOf<BrowseGroup>()
        var albumJob: Job? = null
        fun drawAlbums() {
            groupRows(albumRows, currentAlbums, "albums", { showAlbum(it.id, it.title, name, name) },
                { playGroup("library/tracks?album_id=${Api.encode(it.id)}") })
            if (currentAlbums.isEmpty()) label("No albums found on this page", albumRows)
        }
        fun loadAlbums() {
            albumJob?.cancel()
            val term = filter.text.toString().trim()
            artistAlbumFilters[name] = term
            artistAlbumOffsets[name] = albumOffset
            albumRows.removeAllViews(); label("Loading albums…", albumRows)
            albumPaging.removeAllViews()
            albumJob = pageScope.launch { try {
                val values = api.array("library/albums?artist=${Api.encode(name)}&q=${Api.encode(term)}&limit=40&offset=$albumOffset").objects()
                currentAlbums = values.map { BrowseGroup(it.optString("id"), it.optString("title"), "${it.optInt("track_count")} songs", "${it.optString("artist")} · ${it.optInt("track_count")} songs", it.optString("thumbnail_url")) }
                drawAlbums()
                if (albumOffset > 0) action("Previous albums", albumPaging) { albumOffset = (albumOffset - 40).coerceAtLeast(0); loadAlbums() }
                if (values.size == 40) action("Next albums", albumPaging) { albumOffset += 40; loadAlbums() }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { albumRows.removeAllViews(); label(e.message ?: "Could not load albums", albumRows) } }
        }
        debounce(filter) { albumOffset = 0; loadAlbums() }
        viewPicker("albums", content) { drawAlbums() }
        content.addView(albumRows); content.addView(albumPaging)

        label("Songs")
        val songRows = box(0)
        val songPaging = box(0)
        var songOffset = artistSongOffsets[name] ?: 0
        var currentSongs = listOf<Track>()
        var songJob: Job? = null
        fun loadSongs() {
            songJob?.cancel()
            artistSongOffsets[name] = songOffset
            songRows.removeAllViews(); label("Loading songs…", songRows)
            songPaging.removeAllViews()
            songJob = pageScope.launch { try {
                val songs = api.array("library/tracks?artist=${Api.encode(name)}&limit=50&offset=$songOffset").objects().map(Track::from)
                currentSongs = songs
                renderTracks(songRows, songs, "songs")
                if (songOffset > 0) action("Previous songs", songPaging) { songOffset = (songOffset - 50).coerceAtLeast(0); loadSongs() }
                if (songs.size == 50) action("Next songs", songPaging) { songOffset += 50; loadSongs() }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { songRows.removeAllViews(); label(e.message ?: "Could not load songs", songRows) } }
        }
        viewPicker("songs", content) { renderTracks(songRows, currentSongs, "songs") }
        content.addView(songRows); content.addView(songPaging)
        loadAlbums(); loadSongs()
    }
    private fun showAlbum(id: String, title: String, artist: String, fromArtist: String? = null) {
        screenJob?.cancel()
        val pageJob = SupervisorJob(scope.coroutineContext[Job])
        screenJob = pageJob
        val pageScope = CoroutineScope(Dispatchers.Main.immediate + pageJob)
        backAction = { if (fromArtist != null) showArtist(fromArtist) else home() }; frame(title, detail = true)
        label(artist)
        action("▶ Play album") { playGroup("library/tracks?album_id=${Api.encode(id)}") }
        val warning = box(0); content.addView(warning)
        label("Tracklist")
        val list = box(0)
        val paging = box(0)
        var offset = 0
        var tracks = listOf<Track>()
        var trackJob: Job? = null
        fun draw() {
            list.removeAllViews()
            val discs = tracks.map { it.discNumber ?: 1 }.distinct().sorted()
            for (disc in discs) {
                if (discs.size > 1) label("Disc $disc", list)
                val songs = box(0)
                renderTracks(songs, tracks.filter { (it.discNumber ?: 1) == disc }, "songs", numbered = true)
                list.addView(songs)
            }
            if (tracks.isEmpty()) label("No songs found on this page", list)
        }
        fun load() {
            trackJob?.cancel()
            list.removeAllViews(); label("Loading tracklist…", list)
            paging.removeAllViews()
            trackJob = pageScope.launch { try {
                tracks = api.array("library/tracks?album_id=${Api.encode(id)}&limit=50&offset=$offset").objects().map(Track::from)
                warning.removeAllViews()
                if (tracks.any { it.trackNumber == null }) label("Sync Jellyfin again in Settings to load album track order.", warning)
                draw()
                if (offset > 0) action("Previous tracks", paging) { offset = (offset - 50).coerceAtLeast(0); load() }
                if (tracks.size == 50) action("Next tracks", paging) { offset += 50; load() }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { list.removeAllViews(); label(e.message ?: "Could not load tracklist", list) } }
        }
        viewPicker("songs", content) { draw() }
        content.addView(list); content.addView(paging)
        load()
    }
    private fun showTracks(title: String, path: String, playlistId: Long? = null) {
        screenJob?.cancel(); backAction = { home() }; content.removeAllViews(); titleView.text = title
        action("Back") { home() }
        screenJob = scope.launch { try {
            val tracks = if (playlistId == null) api.array(path).objects().map(Track::from)
                else api.obj(path).getJSONArray("tracks").objects().filter { !it.isNull("video_id") }.map(Track::from)
            if (tracks.isNotEmpty()) action("Play all") { play(tracks, 0) }
            val list = box(0)
            viewPicker("songs", content) { renderTracks(list, tracks, "songs") }
            content.addView(list); renderTracks(list, tracks, "songs")
        } catch (e: Exception) { showError(e) } }
    }
    private fun playlists() {
        action("Liked tracks") { showTracks("Liked tracks", "likes") }
        action("Recently played") { showTracks("Recently played", "history?limit=100") }
        action("Create playlist") {
            val form = box(); val name = input("Playlist name", target = form)
            AlertDialog.Builder(this).setTitle("New playlist").setView(form).setPositiveButton("Create") { _, _ -> launchWork {
                api.call("playlists", "POST", JSONObject().put("name", name.text.toString())); home()
            } }.setNegativeButton("Cancel", null).show()
        }
        screenJob = scope.launch { try {
            for (p in api.array("playlists").objects()) action("${p.optString("name")} · ${p.optInt("track_count")} tracks") { showTracks(p.getString("name"), "playlists/${p.getLong("id")}", p.getLong("id")) }
            label("Household playlists")
            for (p in api.array("playlists?scope=household").objects()) action(p.optString("name")) { showTracks(p.getString("name"), "playlists/${p.getLong("id")}", p.getLong("id")) }
        } catch (e: Exception) { showError(e) } }
    }
    private fun settings() {
        label("Signed in as ${user.optString("display_name")} · ${session.household}")
        label("Library")
        val server = input("Jellyfin server URL")
        val username = input("Jellyfin username")
        val password = input("Jellyfin password", secret = true)
        val status = text("Checking connection…", color = secondary); content.addView(status)
        launchWork {
            val r = api.obj("jellyfin/status")
            status.text = if (r.optBoolean("linked")) "${r.getJSONObject("connection").optString("display_name")} · ${r.optInt("track_count")} tracks\nLast sync: ${r.getJSONObject("connection").optString("synced_at", "Never")}" else "No Jellyfin account linked"
            if (r.optBoolean("linked")) server.setText(r.getJSONObject("connection").optString("server_url")) else server.setText(r.optString("default_server_url", "").takeUnless { it == "null" } ?: "")
        }
        action("Link Jellyfin and sync") { launchWork {
            api.call("jellyfin/link", "POST", JSONObject().put("server_url", server.text.toString()).put("username", username.text.toString()).put("password", password.text.toString()))
            password.setText(""); api.call("jellyfin/sync", "POST"); status.text = "Library sync queued. You can browse while it runs."
        } }
        action("Sync library") { launchWork { api.call("jellyfin/sync", "POST"); status.text = "Library sync queued" } }
        action("Unlink Jellyfin") { AlertDialog.Builder(this).setMessage("Unlink your Jellyfin account and remove its Tuneflow index?").setPositiveButton("Unlink") { _, _ -> launchWork { controller?.stop(); controller?.clearMediaItems(); api.call("jellyfin", "DELETE"); home() } }.setNegativeButton("Cancel", null).show() }
        if (permission("manage_household_members")) action("Family members") { family() }
        if (user.optBoolean("is_root_admin")) action("Create household") { createHousehold() }
        action("Sign out") { launchWork {
            val enforced = api.obj("auth/parent-pin/enforced").optBoolean("enforced")
            if (enforced) {
                val form = box(); val pin = input("Parent PIN", secret = true, target = form)
                AlertDialog.Builder(this@MainActivity).setTitle("Parent PIN").setView(form).setPositiveButton("Continue") { _, _ -> launchWork {
                    if (api.obj("auth/verify-parent-pin", "POST", JSONObject().put("pin", pin.text.toString())).optBoolean("valid")) logout() else throw IllegalStateException("Incorrect PIN")
                } }.setNegativeButton("Cancel", null).show()
            } else logout()
        } }
    }
    private fun permission(name: String) = user.optBoolean("is_root_admin") || user.optJSONArray("permissions")?.let { a -> (0 until a.length()).any { a.optString(it) == name } } == true
    private fun family() {
        backAction = { home() }; content.removeAllViews(); titleView.text = "Family"; action("Back") { home() }
        action("Create member") { memberForm() }
        launchWork {
            for (member in api.array("users").objects()) action("${member.optString("display_name")} · ${member.optString("username")}") {
                if (permission("manage_parental_controls")) parental(member)
            }
        }
    }
    private fun memberForm() {
        launchWork {
            val roles = api.array("role-profiles").objects()
            val form = box(); val name = input("Display name", target = form); val username = input("Username", target = form); val password = input("Password", secret = true, target = form)
            val role = Spinner(this@MainActivity).apply { adapter = ArrayAdapter(this@MainActivity, android.R.layout.simple_spinner_dropdown_item, roles.map { it.optString("name") }) }; form.addView(role)
            AlertDialog.Builder(this@MainActivity).setTitle("Create member").setView(form).setPositiveButton("Create") { _, _ -> launchWork {
                api.call("users", "POST", JSONObject().put("display_name", name.text.toString()).put("username", username.text.toString()).put("password", password.text.toString()).put("role_profile_ids", JSONArray().put(roles[role.selectedItemPosition].getLong("id")))); family()
            } }.setNegativeButton("Cancel", null).show()
        }
    }
    private fun parental(member: JSONObject) {
        launchWork {
            val id = member.getLong("id"); val current = api.obj("parental/$id/settings")
            val form = box()
            val explicit = CheckBox(this@MainActivity).apply { text = "Block explicit content"; isChecked = current.optBoolean("block_explicit") }; form.addView(explicit)
            val search = CheckBox(this@MainActivity).apply { text = "Allow search"; isChecked = current.optBoolean("search_enabled") }; form.addView(search)
            val minutes = input("Daily minutes (blank for unlimited)", if (current.isNull("max_daily_minutes")) "" else current.optString("max_daily_minutes"), target = form)
            AlertDialog.Builder(this@MainActivity).setTitle(member.optString("display_name")).setView(form).setPositiveButton("Save") { _, _ -> launchWork {
                api.call("parental/$id/settings", "PUT", JSONObject().put("block_explicit", explicit.isChecked).put("search_enabled", search.isChecked).put("max_daily_minutes", minutes.text.toString().toIntOrNull() ?: JSONObject.NULL))
            } }.setNegativeButton("Cancel", null).show()
        }
    }
    private fun createHousehold() {
        val form = box(); val name = input("Household name", target = form); val slug = input("Household slug", target = form)
        val username = input("Administrator username", target = form); val display = input("Administrator display name", target = form); val password = input("Administrator password", secret = true, target = form)
        AlertDialog.Builder(this).setTitle("New household").setView(form).setPositiveButton("Create") { _, _ -> launchWork {
            api.call("households", "POST", JSONObject().put("name", name.text.toString()).put("slug", slug.text.toString()).put("admin_username", username.text.toString()).put("admin_display_name", display.text.toString()).put("admin_password", password.text.toString()))
            Toast.makeText(this@MainActivity, "Household created", Toast.LENGTH_LONG).show()
        } }.setNegativeButton("Cancel", null).show()
    }
    private fun logout() {
        controller?.stop(); controller?.clearMediaItems(); controller?.release(); controller = null
        controllerFuture?.let { MediaController.releaseFuture(it) }; controllerFuture = null
        stopService(android.content.Intent(this, PlaybackService::class.java))
        session.clear(); loginScreen()
    }
    override fun onDestroy() {
        screenJob?.cancel(); tick.removeCallbacksAndMessages(null); scope.cancel()
        controllerFuture?.let { MediaController.releaseFuture(it) }; controller = null
        super.onDestroy()
    }
    private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
}
