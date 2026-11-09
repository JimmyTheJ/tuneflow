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
import androidx.media3.session.SessionCommand
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executor

/** Native Android Views; the service owns playback independently of this screen. */
@UnstableApi
class MainActivity : Activity() {
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
    private var sheetTransport: ImageView? = null
    private var sheetRepeat: TextView? = null
    private var lastRenderedTab = ""
    private fun searchHistory() = SearchHistory(this, "${session.server}|${session.userId}")
    private var sheetTitle: TextView? = null
    private var sheetArtist: TextView? = null
    private var sheetArtwork: ImageView? = null
    private var sheetElapsed: TextView? = null
    private var sheetDuration: TextView? = null
    private var navigationEnabled = false
    private var playGeneration = 0L
    private var sharedSpotifyLink: String? = null
    private var tab = "Home"
    private var pageOffset = 0
    private var backAction: (() -> Unit)? = null
    private val browseQueries = mutableMapOf<String, String>()
    private val letterLibraryStates = mutableMapOf<String, LetterLibraryState>()
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
        readSharedPlaylist(intent)
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
    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent); setIntent(intent); readSharedPlaylist(intent)
        if (navigationEnabled) offerSharedPlaylist()
    }
    private fun readSharedPlaylist(intent: android.content.Intent) {
        if (intent.action == android.content.Intent.ACTION_SEND) {
            val text = intent.getStringExtra(android.content.Intent.EXTRA_TEXT).orEmpty()
            sharedSpotifyLink = SpotifyLinks.fromSharedText(text)
            if (sharedSpotifyLink == null) Toast.makeText(this, "Share a Spotify playlist link to import it", Toast.LENGTH_LONG).show()
        }
    }
    private fun offerSharedPlaylist() {
        val link = sharedSpotifyLink ?: return
        sharedSpotifyLink = null
        importSpotify(link)
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
        playGeneration++; playerSheet?.dismiss(); letterLibraryStates.clear()
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
        if (lastRenderedTab == "YouTube" && tab != "YouTube" && !searchHistory().rememberResults) searchHistory().clearResults()
        lastRenderedTab = tab
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
        offerSharedPlaylist()
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
        label("Welcome back, ${user.optString("display_name", "music lover")}")
        val recent = box(0); content.addView(recent)
        val lists = box(0); content.addView(lists)
        screenJob = scope.launch {
            try {
                recent.addView(text("Recently played", 21f).apply { setTypeface(null, Typeface.BOLD) })
                val tracks = api.array("history?limit=12").objects().map(Track::from).distinctBy { it.id }
                if (tracks.isEmpty()) label("Your listening history will appear here. Pick something from Library or YouTube to begin.", recent)
                else tracks.forEach { track -> trackRow(recent, track) { play(listOf(track), 0) } }
            } catch (e: CancellationException) { throw e } catch (_: Exception) { label("Recently played is unavailable right now.", recent) }
            try {
                val playlists = api.array("playlists").objects().take(6)
                if (playlists.isNotEmpty()) lists.addView(text("Your playlists", 21f).apply { setTypeface(null, Typeface.BOLD) })
                playlists.forEach { p -> action("${p.optString("name")} · ${p.optInt("track_count")} tracks", lists) { showTracks(p.getString("name"), "playlists/${p.getLong("id")}", p.getLong("id")) } }
            } catch (e: CancellationException) { throw e } catch (_: Exception) { label("Playlists are unavailable right now.", lists) }
        }
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
        sheetTransport?.setImageResource(if (p.isPlaying) R.drawable.ic_pause else R.drawable.ic_play)
        sheetTransport?.contentDescription = if (p.isPlaying) "Pause" else "Play"
        sheetRepeat?.apply {
            text = when (p.repeatMode) { Player.REPEAT_MODE_ONE -> "Repeat track"; Player.REPEAT_MODE_ALL -> "Repeat playlist"; else -> "Repeat off" }
            setTextColor(if (p.repeatMode == Player.REPEAT_MODE_OFF) secondary else mint)
        }
        sheetTitle?.text = item?.mediaMetadata?.title ?: "Nothing playing"
        sheetArtist?.text = item?.mediaMetadata?.artist ?: ""
        sheetElapsed?.text = formatTime(p.currentPosition)
        sheetDuration?.text = formatTime(p.duration)
        val artwork = item?.mediaMetadata?.artworkUri?.toString().orEmpty()
        if (shownArtwork != artwork) { shownArtwork = artwork; loadArtwork(miniArtwork, artwork); loadArtwork(sheetArtwork, artwork) }
        if (p.duration > 0 && progress?.isPressed != true) progress?.progress = (p.currentPosition * 1000 / p.duration).toInt()
        if (p.duration > 0 && sheetProgress?.isPressed != true) sheetProgress?.progress = (p.currentPosition * 1000 / p.duration).toInt()
    }
    private fun imageButton(icon: Int, description: String, color: Int = Color.WHITE, run: () -> Unit) = ImageView(this).apply {
        setImageResource(icon); imageTintList = android.content.res.ColorStateList.valueOf(color)
        setPadding(dp(12), dp(12), dp(12), dp(12)); contentDescription = description
        isFocusable = true; setOnClickListener { run() }
    }
    private fun pill(value: String, icon: Int, run: () -> Unit) = text(value, 12f, secondary).apply {
        gravity = Gravity.CENTER; background = rounded(surface, 24); setPadding(dp(14), dp(10), dp(14), dp(10))
        setCompoundDrawablesRelativeWithIntrinsicBounds(icon, 0, 0, 0)
        compoundDrawableTintList = android.content.res.ColorStateList.valueOf(mint); compoundDrawablePadding = dp(8)
        setOnClickListener { run() }; isFocusable = true
    }
    private fun nextTrack() { controller?.let { p ->
        if (p.hasNextMediaItem()) p.seekToNextMediaItem() else { p.stop(); p.clearMediaItems() }
    } }
    private fun nowPlaying() {
        val p = controller ?: return
        if (playerSheet?.isShowing == true) return
        val dialog = android.app.Dialog(this)
        val panel = box(0).apply { background = rounded(Color.rgb(21, 25, 29), 24) }
        val handle = text("━━", 19f, secondary).apply { gravity = Gravity.CENTER; setPadding(0, dp(6), 0, 0); contentDescription = "Drag down to collapse player" }
        panel.addView(handle)
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(dp(20), 0, dp(8), 0) }
        top.addView(text("NOW PLAYING", 12f, secondary).apply { letterSpacing = 0.12f }, LinearLayout.LayoutParams(0, -2, 1f))
        top.addView(imageButton(R.drawable.ic_more, "Track information") { p.currentMediaItem?.let { trackInfo(trackFromItem(it)) } }, LinearLayout.LayoutParams(dp(48), dp(48)))
        top.addView(imageButton(R.drawable.ic_collapse, "Collapse player") { dialog.dismiss() }, LinearLayout.LayoutParams(dp(48), dp(48)))
        panel.addView(top)
        val player = box(0)
        sheetArtwork = ImageView(this).apply { scaleType = ImageView.ScaleType.CENTER_CROP; background = rounded(Color.rgb(44, 49, 53), 16); clipToOutline = true }
        val artSize = (resources.displayMetrics.widthPixels - dp(72)).coerceAtMost(dp(310))
        player.addView(sheetArtwork, LinearLayout.LayoutParams(artSize, artSize).apply { gravity = Gravity.CENTER_HORIZONTAL; topMargin = dp(16); bottomMargin = dp(22) })
        sheetTitle = text("", 24f).apply { setTypeface(null, Typeface.BOLD); setOnClickListener { p.currentMediaItem?.let { trackInfo(trackFromItem(it)) } } }
        sheetArtist = text("", 15f, secondary)
        player.addView(sheetTitle); player.addView(sheetArtist)
        sheetProgress = SeekBar(this).apply { max = 1000; setOnSeekBarChangeListener(seekListener()) }
        player.addView(sheetProgress)
        val times = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        sheetElapsed = text("0:00", 12f, secondary); sheetDuration = text("0:00", 12f, secondary)
        times.addView(sheetElapsed, LinearLayout.LayoutParams(0, -2, 1f)); times.addView(sheetDuration)
        player.addView(times)
        val controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER; setPadding(0, dp(8), 0, dp(20)) }
        controls.addView(imageButton(R.drawable.ic_previous, "Restart track") { p.seekTo(0) }, LinearLayout.LayoutParams(dp(64), dp(64)))
        sheetTransport = imageButton(R.drawable.ic_play, "Play", Color.BLACK) { togglePlayback() }.apply {
            background = rounded(mint, 40); setPadding(dp(20), dp(20), dp(20), dp(20))
        }
        controls.addView(sheetTransport, LinearLayout.LayoutParams(dp(76), dp(76)).apply { leftMargin = dp(26); rightMargin = dp(26) })
        controls.addView(imageButton(R.drawable.ic_next, "Next track") { nextTrack() }, LinearLayout.LayoutParams(dp(64), dp(64)))
        player.addView(controls)
        val options = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        sheetRepeat = pill("Repeat off", R.drawable.ic_repeat) {
            p.repeatMode = when (p.repeatMode) { Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL; Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE; else -> Player.REPEAT_MODE_OFF }
            updatePlayer()
        }
        options.addView(sheetRepeat, LinearLayout.LayoutParams(0, dp(46), 1f).apply { marginEnd = dp(8) })
        options.addView(pill("Shuffle playlist", R.drawable.ic_shuffle) {
            p.shuffleModeEnabled = false
            val start = PlaybackQueue.manualEnd(p)
            val original = (start until p.mediaItemCount).map { PlaybackQueue.entry(p.getMediaItemAt(it)) }
            original.shuffled().forEachIndexed { offset, key ->
                val from = (start until p.mediaItemCount).firstOrNull { PlaybackQueue.entry(p.getMediaItemAt(it)) == key }
                if (from != null) p.moveMediaItem(from, start + offset)
            }
        }, LinearLayout.LayoutParams(0, dp(46), 1f))
        player.addView(options)
        player.addView(text("Clear upcoming songs", 13f, secondary).apply {
            gravity = Gravity.CENTER; setPadding(0, dp(14), 0, dp(6))
            setOnClickListener { if (p.mediaItemCount > 0) p.removeMediaItems(p.currentMediaItemIndex + 1, p.mediaItemCount) }
        })
        panel.addView(PlayerQueuePanel(this, p, player, { view, url -> loadArtwork(view, url) }, { media -> trackMenu(trackFromItem(media)) }), LinearLayout.LayoutParams(-1, 0, 1f))
        var downY = 0f
        handle.setOnTouchListener { view, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> downY = event.rawY
                MotionEvent.ACTION_UP -> { if (event.rawY - downY > dp(70)) dialog.dismiss() else view.performClick() }
            }; true
        }
        dialog.setContentView(panel)
        dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        dialog.window?.setGravity(Gravity.BOTTOM)
        dialog.window?.attributes?.windowAnimations = R.style.PlayerSheetAnimation
        dialog.setOnDismissListener { playerSheet = null; sheetProgress = null; sheetTransport = null; sheetRepeat = null; sheetTitle = null; sheetArtist = null; sheetArtwork = null; sheetElapsed = null; sheetDuration = null }
        playerSheet = dialog; dialog.show()
        dialog.window?.setLayout(-1, (resources.displayMetrics.heightPixels * 0.94f).toInt())
        loadArtwork(sheetArtwork, p.currentMediaItem?.mediaMetadata?.artworkUri?.toString())
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
        if (tab == "YouTube") { youtubeDiscovery(); return }
        label("Fast playback from your Jellyfin collection.")
        val query = input("Search your library", browseQueries["songs"].orEmpty())
        val results = box(0); content.addView(results)
        val songList = box(0)
        var displayedTracks = listOf<Track>()
        lateinit var load: (String, Int) -> Unit
        load = { value, offset ->
            browseQueries["songs"] = value
            screenJob?.cancel(); results.removeAllViews(); label("Loading…", results)
            screenJob = scope.launch {
                try {
                    val tracks = api.array("library/tracks?q=${Api.encode(value)}&limit=100&offset=$offset").objects().map(Track::from)
                    results.removeAllViews(); displayedTracks = tracks
                    if (tracks.isEmpty()) label("No tracks found. Link Jellyfin and sync your library in Settings.", results)
                    else {
                        action("Play all", results) { play(tracks, 0, ordered = true, contextName = "Library search") }
                        results.addView(songList); renderTracks(songList, tracks, "songs")
                    }
                    if (offset > 0) action("Previous page", results) { pageOffset = (offset - 100).coerceAtLeast(0); load(value, pageOffset) }
                    if (tracks.size == 100) action("Next page", results) { pageOffset = offset + 100; load(value, pageOffset) }
                } catch (e: CancellationException) { throw e } catch (e: Exception) {
                    results.removeAllViews(); label(e.message ?: "Could not load music", results)
                }
            }
        }
        val picker = box(0); content.addView(picker, content.indexOfChild(results))
        viewPicker("songs", picker) { renderTracks(songList, displayedTracks, "songs") }
        debounce(query) { pageOffset = 0; load(query.text.toString().trim(), 0) }
        load(query.text.toString().trim(), 0)
    }
    private fun youtubeDiscovery() {
        val history = searchHistory()
        val searchRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        val inputBox = box(0)
        val query = input("Search YouTube", history.draft, target = inputBox).apply { imeOptions = android.view.inputmethod.EditorInfo.IME_ACTION_SEARCH }
        searchRow.addView(inputBox, LinearLayout.LayoutParams(0, -2, 1f))
        content.addView(searchRow)
        val suggestions = box(0); content.addView(suggestions)
        val results = box(0); content.addView(results)
        var displayed = history.results
        var resultQuery = history.resultQuery
        lateinit var submit: (String) -> Unit
        fun drawResults() {
            results.removeAllViews()
            if (resultQuery.isEmpty()) return
            results.addView(text("Results for “$resultQuery”", 18f).apply { setTypeface(null, Typeface.BOLD) })
            if (displayed.isEmpty()) label("No matches found", results)
            else {
                action("Play all · ${displayed.size} tracks", results) { play(displayed, 0, ordered = true, contextName = "YouTube · $resultQuery") }
                val list = box(0)
                viewPicker("youtube", results) { renderTracks(list, displayed, "youtube") }
                results.addView(list); renderTracks(list, displayed, "youtube")
            }
        }
        fun drawSuggestions() {
            suggestions.removeAllViews()
            val value = query.text.toString()
            val matches = SearchSuggestions.matches(value, history.recent())
            if (matches.isEmpty()) {
                if (resultQuery.isEmpty()) label(if (value.isBlank()) "Search for a song, artist or video. Recent searches will appear here." else "Press Search to discover music on YouTube.", suggestions)
                return
            }
            val heading = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
            heading.addView(text(if (value.isBlank()) "Recent searches" else "From your searches", 13f, secondary), LinearLayout.LayoutParams(0, -2, 1f))
            heading.addView(text("Clear history", 12f, mint).apply { setPadding(dp(12), dp(14), 0, dp(14)); setOnClickListener { history.clearHistory(); drawSuggestions() } })
            suggestions.addView(heading)
            matches.take(if (resultQuery.isNotEmpty() && !query.hasFocus()) 3 else 12).forEach { term ->
                val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
                row.addView(text("↖   $term", 15f).apply {
                    maxLines = 2; setPadding(dp(10), dp(12), dp(6), dp(12))
                    setOnClickListener { query.setText(term); query.setSelection(term.length); submit(term) }
                }, LinearLayout.LayoutParams(0, -2, 1f))
                row.addView(iconButton("×", "Remove search $term") { history.remove(term); drawSuggestions() }.apply { setTextColor(secondary); textSize = 22f }, LinearLayout.LayoutParams(dp(44), dp(48)))
                suggestions.addView(row)
            }
        }
        submit = { raw ->
            val value = raw.trim().take(300)
            if (value.isNotEmpty()) {
                history.draft = value; history.record(value); query.clearFocus()
                (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).hideSoftInputFromWindow(query.windowToken, 0)
                screenJob?.cancel(); results.removeAllViews(); label("Searching YouTube…", results); drawSuggestions()
                screenJob = scope.launch {
                    try {
                        val response = api.obj("music/search?source=youtube&q=${Api.encode(value)}&limit=25")
                        displayed = response.getJSONArray("groups").objects().map { Track.from(it.getJSONObject("primary")) }
                        resultQuery = value; history.resultQuery = value; history.results = displayed
                        drawResults(); drawSuggestions()
                    } catch (e: CancellationException) { throw e } catch (e: Exception) {
                        results.removeAllViews(); label(e.message ?: "Could not search YouTube", results)
                        action("Retry", results) { submit(value) }
                    }
                }
            }
        }
        searchRow.addView(imageButton(R.drawable.ic_search, "Search YouTube", mint) { submit(query.text.toString()) }, LinearLayout.LayoutParams(dp(48), dp(52)))
        searchRow.addView(iconButton("×", "Clear YouTube search and results") {
            screenJob?.cancel(); displayed = emptyList(); resultQuery = ""; history.clearResults(); query.setText(""); drawResults(); drawSuggestions()
        }.apply { setTextColor(secondary) }, LinearLayout.LayoutParams(dp(44), dp(52)))
        query.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) { history.draft = s.toString(); drawSuggestions() }
            override fun afterTextChanged(s: Editable?) {}
        })
        query.setOnFocusChangeListener { _, _ -> drawSuggestions() }
        query.setOnEditorActionListener { _, _, _ -> submit(query.text.toString()); true }
        drawResults(); drawSuggestions()
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
            .setMediaMetadata(MediaMetadata.Builder().setTitle(track.title).setArtist(track.artist).setArtworkUri(artwork)
                .setExtras(Bundle().apply { putString("track_json", track.json().toString()) }).build())
        stream?.optString("mime_type")?.takeIf { it.isNotBlank() && it != "null" }?.let(builder::setMimeType)
        return builder.build()
    }
    private fun play(tracks: List<Track>, start: Int, ordered: Boolean = false, contextName: String = titleView.text.toString()) {
        val player = controller ?: run { showError(Exception("Player is connecting; try again")); return }
        val selected = tracks.getOrNull(start) ?: return
        if (selected.blocked.isNotEmpty()) { showError(Exception(selected.blocked)); return }
        val playable = tracks.drop(start).filter { it.blocked.isEmpty() }
        val generation = ++playGeneration
        player.sendCustomCommand(SessionCommand(PlaybackService.CANCEL_SELECTION, Bundle.EMPTY), Bundle.EMPTY)
        val singles = tracks.size == 1 && !ordered
        fun startPlayback(stream: JSONObject?) {
            if (generation != playGeneration) return
            val selection = PlaybackQueue.tagged(item(selected, stream),
                if (singles) PlaybackQueue.MANUAL else PlaybackQueue.CONTEXT, contextName)
            val args = Bundle().apply {
                putBundle("selected", selection.toBundleIncludeLocalConfiguration())
                if (!singles) putBinder("background", BundleListRetriever(playable.drop(1).map {
                    PlaybackQueue.tagged(item(it), PlaybackQueue.CONTEXT, contextName).toBundleIncludeLocalConfiguration()
                }))
            }
            val pending = player.sendCustomCommand(SessionCommand(PlaybackService.SELECT, Bundle.EMPTY), args)
            pending.addListener({
                if (generation == playGeneration) runCatching { pending.get() }.onSuccess { result ->
                    if (result.resultCode < 0) showError(Exception("Audio could not be buffered. Please try again."))
                }.onFailure { showError(Exception("Playback could not start", it)) }
            }, Executor { tick.post(it) })
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
    private fun trackFromItem(media: MediaItem): Track = runCatching {
        Track.from(JSONObject(media.mediaMetadata.extras?.getString("track_json").orEmpty()))
    }.getOrElse { Track(media.mediaId, media.mediaMetadata.title?.toString().orEmpty(), media.mediaMetadata.artist?.toString().orEmpty(), artwork = media.mediaMetadata.artworkUri?.toString().orEmpty()) }
    private fun trackInfo(track: Track) {
        val dialog = android.app.Dialog(this)
        val panel = box(20).apply { background = rounded(surface, 24) }
        val heading = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        heading.addView(text("Track information", 20f).apply { setTypeface(null, Typeface.BOLD) }, LinearLayout.LayoutParams(0, -2, 1f))
        heading.addView(iconButton("×", "Close track information") { dialog.dismiss() }, LinearLayout.LayoutParams(dp(48), dp(48)))
        panel.addView(heading)
        val details = box(0)
        fun field(name: String, value: String) {
            if (value.isBlank()) return
            details.addView(text(name.uppercase(), 11f, secondary).apply { letterSpacing = 0.08f; setPadding(0, dp(16), 0, dp(4)) })
            details.addView(text(value, 16f).apply { setTextIsSelectable(true) })
        }
        field("Title", track.title)
        if (track.sourceTitle != track.title) field("Video title", track.sourceTitle)
        field("Artist", track.artist); field("Uploaded by", track.uploader)
        if (track.playlistId > 0) {
            field("Added by", track.addedBy.ifBlank { "Unknown (not recorded)" })
            field("Added to playlist", track.addedAt)
        }
        field("Album", track.album)
        if (track.duration > 0) field("Duration", formatTime(track.duration * 1000))
        if (track.spotifyId.isNotBlank()) field("Spotify link", "https://open.spotify.com/track/${track.spotifyId}")
        if (track.id.matches(Regex("[A-Za-z0-9_-]{11}"))) {
            val url = "https://www.youtube.com/watch?v=${track.id}"
            field("YouTube link", url); field("Channel", track.channelId); field("Video ID", track.id)
            action("Open in YouTube", details) { startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, Uri.parse(url))) }
            action("Copy link", details) {
                (getSystemService(CLIPBOARD_SERVICE) as android.content.ClipboardManager).setPrimaryClip(android.content.ClipData.newPlainText(track.title, url))
                Toast.makeText(this, "Link copied", Toast.LENGTH_SHORT).show()
            }
        } else field("Source", if (track.id.startsWith("jf_")) "Jellyfin" else "Spotify · no playable match selected")
        panel.addView(ScrollView(this).apply { addView(details) }, LinearLayout.LayoutParams(-1, 0, 1f))
        dialog.setContentView(panel); dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        dialog.window?.setGravity(Gravity.BOTTOM); dialog.window?.attributes?.windowAnimations = R.style.PlayerSheetAnimation
        dialog.show(); dialog.window?.setLayout(-1, (resources.displayMetrics.heightPixels * 0.8f).toInt())
    }
    private fun trackMenu(track: Track) {
        val dialog = android.app.Dialog(this)
        val panel = box(20).apply { background = rounded(surface, 24) }
        panel.addView(text(track.title, 19f).apply { maxLines = 2; ellipsize = android.text.TextUtils.TruncateAt.END; setTypeface(null, Typeface.BOLD) })
        panel.addView(text(track.artist, 13f, secondary))
        fun option(label: String, run: () -> Unit) {
            panel.addView(text(label, 16f).apply {
                setPadding(dp(8), dp(16), dp(8), dp(16)); isFocusable = true
                setOnClickListener { dialog.dismiss(); run() }
            })
        }
        if (track.blocked.isEmpty()) {
            option("Play next") { controller?.let { PlaybackQueue.add(it, item(track), next = true) } }
            option("Add to your queue") { controller?.let { PlaybackQueue.add(it, item(track)) } }
        }
        option("Info") { trackInfo(track) }
        if (track.canManagePlaylist && track.playlistId > 0) option("Choose playable match") { findPlaylistMatch(track) }
        if (track.canManagePlaylist && track.playlistId > 0) option("Remove from playlist") {
            AlertDialog.Builder(this).setTitle("Remove track?").setMessage(track.title)
                .setPositiveButton("Remove") { _, _ -> launchWork {
                    api.call("playlists/${track.playlistId}/tracks/${track.playlistTrackId}", "DELETE")
                    showTracks(titleView.text.toString(), "playlists/${track.playlistId}", track.playlistId)
                } }.setNegativeButton("Cancel", null).show()
        }
        if (track.id.isNotBlank() && track.id != "null") option("Like") { launchWork { api.call("likes", "POST", track.json()); Toast.makeText(this@MainActivity, "Liked", Toast.LENGTH_SHORT).show() } }
        option("Add to playlist") { launchWork {
            val playlists = (api.array("playlists").objects() + api.array("playlists?scope=household").objects())
                .distinctBy { it.getLong("id") }.filter { it.optBoolean("can_manage", it.optBoolean("is_owner")) }
            AlertDialog.Builder(this@MainActivity).setTitle("Add to playlist").setItems(playlists.map { it.optString("name") }.toTypedArray()) { _, index ->
                launchWork { api.call("playlists/${playlists[index].getLong("id")}/tracks", "POST", track.json()); Toast.makeText(this@MainActivity, "Added", Toast.LENGTH_SHORT).show() }
            }.show()
        } }
        option("Cancel") { }
        dialog.setContentView(panel); dialog.window?.setBackgroundDrawableResource(android.R.color.transparent)
        dialog.window?.setGravity(Gravity.BOTTOM); dialog.window?.attributes?.windowAnimations = R.style.PlayerSheetAnimation
        dialog.show(); dialog.window?.setLayout(-1, -2)
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
        val pageJob = SupervisorJob(scope.coroutineContext[Job])
        screenJob = pageJob
        val pageScope = CoroutineScope(Dispatchers.Main.immediate + pageJob)
        val state = letterLibraryStates.getOrPut(section) { LetterLibraryState() }
        label(if (artists) "Browse artists by name." else "Browse albums by title.")
        val query = input(if (artists) "Find an artist" else "Find an album", state.query)
        val open: (BrowseGroup) -> Unit = { if (artists) showArtist(it.id) else showAlbum(it.id, it.title, it.subtitle) }
        val playSelected: (BrowseGroup) -> Unit = {
            if (artists) playGroup("library/tracks?artist=${Api.encode(it.id)}") else playGroup("library/tracks?album_id=${Api.encode(it.id)}")
        }
        lateinit var browser: LetterLibraryView
        action("A–Z · Jump to letter", content) { browser.search(query.text.toString().trim()); browser.chooseLetter() }
        viewPicker(section, content) { browser.changeView() }
        val header = content
        header.setPadding(0, dp(8), 0, dp(12))
        (header.parent as? ViewGroup)?.removeView(header)
        browser = LetterLibraryView(this, header, state, pageScope, api, section, { viewMode(section) }, { value ->
            if (artists) {
                check(value.has("album_count")) { "Update the Rust API to enable artist albums" }
                artistSummaries[value.optString("id")] = value.optInt("album_count") to value.optInt("track_count")
                BrowseGroup(value.optString("id"), value.optString("name"), "${value.optInt("album_count")} albums · ${value.optInt("track_count")} songs", "${value.optInt("album_count")} albums · ${value.optInt("track_count")} songs", value.optString("thumbnail_url"))
            } else BrowseGroup(value.optString("id"), value.optString("title"), value.optString("artist"), "${value.optString("artist")} · ${value.optInt("track_count")} songs", value.optString("thumbnail_url"))
        }, { target, entries -> groupRows(target, entries, section, open, playSelected) })
        root.removeViewAt(1)
        root.addView(browser, 1, LinearLayout.LayoutParams(-1, 0, 1f))
        debounce(query) { browser.search(query.text.toString().trim()) }
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
                    action("Track options", tile) { trackMenu(track) }
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
            val playlist = if (playlistId != null) api.obj(path) else null
            if (playlist != null) titleView.text = playlist.optString("name", title)
            if (playlist?.optString("source_type") == "spotify") {
                val summary = playlist.optJSONObject("match_summary")
                label("Spotify import · ${playlist.optInt("track_count")} tracks · ${summary?.optInt("matched") ?: 0} matched · ${summary?.optInt("unmatched") ?: 0} unmatched")
                label("Compare this count with the original Spotify playlist; its public view may omit songs. Use a track's options to choose or correct its recording.")
            }
            val tracks = if (playlist == null) api.array(path).objects().map(Track::from)
                else playlist.getJSONArray("tracks").objects().map { row ->
                    val track = Track.from(row)
                    track.copy(playlistId = playlistId ?: 0,
                        canManagePlaylist = playlist.optBoolean("can_manage", playlist.optBoolean("is_owner")),
                        blocked = if (row.isNull("video_id")) "No playable match" else track.blocked)
                }
            if (playlist != null && playlist.optBoolean("can_manage", playlist.optBoolean("is_owner"))) {
                val family = playlist.optString("visibility") == "household"
                action(if (family) "Move to personal playlists" else "Move to family playlists") {
                    AlertDialog.Builder(this@MainActivity).setTitle("Move playlist?")
                        .setMessage(if (family) "This will become your personal playlist." else "Everyone in your family will be able to see this playlist.")
                        .setPositiveButton("Move") { _, _ -> launchWork {
                            api.call(path, "PATCH", JSONObject().put("visibility", if (family) "private" else "household"))
                            showTracks(title, path, playlistId)
                        } }.setNegativeButton("Cancel", null).show()
                }
                action("Delete playlist") {
                    AlertDialog.Builder(this@MainActivity).setTitle("Delete playlist?").setMessage(title)
                        .setPositiveButton("Delete") { _, _ -> launchWork { api.call(path, "DELETE"); home() } }
                        .setNegativeButton("Cancel", null).show()
                }
            }
            val playable = tracks.filter { it.blocked.isEmpty() }
            if (playable.isNotEmpty()) action("Play all") { play(playable, 0, ordered = true, contextName = title) }
            val list = box(0)
            viewPicker("songs", content) { renderTracks(list, tracks, "songs") }
            content.addView(list); renderTracks(list, tracks, "songs")
        } catch (e: Exception) { showError(e) } }
    }
    private fun importSpotify(initialLink: String = "") {
        val form = box()
        label("Import a snapshot of a public Spotify playlist. Songs match your Jellyfin library first; uncertain matches stay visible for review.", form)
        val link = input("Spotify playlist link", initialLink, target = form)
        val name = input("Playlist name (optional)", target = form)
        val family = Switch(this).apply { text = "Family playlist"; setTextColor(Color.WHITE) }
        val youtube = Switch(this).apply { text = "Match missing songs on YouTube"; isChecked = true; setTextColor(Color.WHITE) }
        form.addView(family); form.addView(youtube)
        label("Spotify's public view may omit tracks in long playlists. Compare the imported count with the original.", form)
        val dialog = AlertDialog.Builder(this).setTitle("Import Spotify playlist")
            .setView(ScrollView(this).apply { addView(form) }).setPositiveButton("Import", null).setNegativeButton("Cancel", null).create()
        dialog.setOnShowListener {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener {
                val url = SpotifyLinks.fromSharedText(link.text.toString())
                if (url == null) { link.error = "Enter a Spotify playlist link"; return@setOnClickListener }
                dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = false
                scope.launch { try {
                    val body = JSONObject().put("provider", "spotify").put("url", url).put("name", name.text.toString().trim())
                        .put("visibility", if (family.isChecked) "household" else "private").put("youtube_fallback", youtube.isChecked)
                    val job = api.obj("imports", "POST", body)
                    dialog.dismiss(); tab = "Playlists"; showImport(job.getLong("id"))
                } catch (e: CancellationException) { throw e } catch (e: Exception) {
                    dialog.getButton(AlertDialog.BUTTON_POSITIVE).isEnabled = true; showError(e)
                } }
            }
        }
        dialog.show()
    }
    private fun showImport(jobId: Long) {
        screenJob?.cancel(); backAction = { tab = "Playlists"; home() }; frame("Playlist import", detail = true)
        val status = text("Checking import…"); content.addView(status)
        val bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply { isIndeterminate = true }
        content.addView(bar)
        label("You can leave this screen. The server continues importing; return through Import history.")
        val result = box(0); content.addView(result)
        screenJob = scope.launch { try {
            while (true) {
                val job = api.obj("imports/$jobId")
                status.text = job.optString("message", "Importing…")
                val total = job.optInt("progress_total")
                bar.isIndeterminate = total <= 0; bar.max = total.coerceAtLeast(1); bar.progress = job.optInt("progress_done")
                when (job.optString("status")) {
                    "completed" -> {
                        bar.visibility = View.GONE
                        action("Open imported playlist", result) {
                            val pid = job.getLong("result_playlist_id")
                            showTracks(job.optString("requested_name").ifBlank { "Imported playlist" }, "playlists/$pid", pid)
                        }
                        return@launch
                    }
                    "failed", "cancelled" -> {
                        bar.visibility = View.GONE; status.text = job.optString("error").takeUnless { it == "null" || it.isBlank() } ?: "Import could not finish"
                        action("Try another link", result) { importSpotify(job.optString("source_url")) }
                        return@launch
                    }
                }
                delay(1000)
            }
        } catch (e: CancellationException) { throw e } catch (e: Exception) {
            bar.visibility = View.GONE; status.text = e.message ?: "Could not check import"
            action("Retry", result) { showImport(jobId) }
        } }
    }
    private fun importHistory() {
        screenJob?.cancel(); backAction = { home() }; frame("Import history", detail = true)
        screenJob = scope.launch { try {
            val jobs = api.array("imports").objects()
            if (jobs.isEmpty()) label("No playlist imports yet")
            for (job in jobs) action("${job.optString("requested_name").takeUnless { it == "null" || it.isBlank() } ?: "Spotify playlist"} · ${job.optString("status")}") { showImport(job.getLong("id")) }
        } catch (e: CancellationException) { throw e } catch (e: Exception) { showError(e) } }
    }
    private fun findPlaylistMatch(track: Track) {
        val form = box(); val query = input("Artist and song", "${track.artist} ${track.title}".trim(), target = form)
        val results = box(0)
        val scroll = ScrollView(this).apply { addView(results) }
        form.addView(scroll, LinearLayout.LayoutParams(-1, dp(300)))
        val dialog = AlertDialog.Builder(this).setTitle("Choose a playable match").setView(form).setNegativeButton("Close", null).create()
        var search: Job? = null
        fun load(youtube: Boolean) {
            search?.cancel(); results.removeAllViews(); label("Searching…", results)
            search = scope.launch { try {
                val q = Api.encode(query.text.toString().trim())
                val tracks = if (youtube) api.obj("music/search?source=youtube&q=$q&limit=10").getJSONArray("groups").objects()
                    .map { Track.from(it.getJSONObject("primary")) } else api.array("library/tracks?q=$q&limit=20").objects().map(Track::from)
                results.removeAllViews()
                if (tracks.isEmpty()) label("No matches found. Try changing the search.", results)
                for (candidate in tracks.filter { it.blocked.isBlank() }) action("${candidate.title} · ${candidate.artist}", results) {
                    AlertDialog.Builder(this@MainActivity).setTitle("Use this recording?").setMessage("${candidate.title}\n${candidate.artist}")
                        .setPositiveButton("Use recording") { _, _ -> launchWork {
                            api.call("playlists/${track.playlistId}/tracks/${track.playlistTrackId}", "PATCH", candidate.json())
                            dialog.dismiss(); showTracks(titleView.text.toString(), "playlists/${track.playlistId}", track.playlistId)
                        } }.setNegativeButton("Cancel", null).show()
                }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { results.removeAllViews(); label(e.message ?: "Search failed", results) } }
        }
        action("Search library", form) { load(false) }; action("Search YouTube", form) { load(true) }
        dialog.setOnDismissListener { search?.cancel() }; dialog.show(); load(false)
    }
    private fun playlists() {
        action("Import Spotify playlist") { importSpotify() }
        action("Import history") { importHistory() }
        action("Liked tracks") { showTracks("Liked tracks", "likes") }
        action("Recently played") { showTracks("Recently played", "history?limit=100") }
        action("Create playlist") {
            val form = box(); val name = input("Playlist name", target = form)
            val family = Switch(this).apply { text = "Family playlist"; setTextColor(Color.WHITE) }
            form.addView(family)
            AlertDialog.Builder(this).setTitle("New playlist").setView(form).setPositiveButton("Create") { _, _ -> launchWork {
                api.call("playlists", "POST", JSONObject().put("name", name.text.toString()).put("visibility", if (family.isChecked) "household" else "private")); home()
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
        val remember = Switch(this).apply {
            text = "Keep YouTube search and results"; setTextColor(Color.WHITE)
            isChecked = searchHistory().rememberResults
            setPadding(0, dp(12), 0, dp(12))
            setOnCheckedChangeListener { _, checked -> searchHistory().rememberResults = checked }
        }
        content.addView(remember)
        label("Keep your last YouTube results when switching pages. Turn off to clear them when leaving YouTube.")
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
        playGeneration++; playerSheet?.dismiss(); letterLibraryStates.clear()
        controller?.stop(); controller?.clearMediaItems(); controller?.release(); controller = null
        controllerFuture?.let { MediaController.releaseFuture(it) }; controllerFuture = null
        stopService(android.content.Intent(this, PlaybackService::class.java))
        session.clear(); loginScreen()
    }
    override fun onDestroy() {
        playerSheet?.dismiss()
        screenJob?.cancel(); tick.removeCallbacksAndMessages(null); scope.cancel()
        controllerFuture?.let { MediaController.releaseFuture(it) }; controller = null
        super.onDestroy()
    }
    private fun JSONArray.objects(): List<JSONObject> = (0 until length()).mapNotNull { optJSONObject(it) }
}
