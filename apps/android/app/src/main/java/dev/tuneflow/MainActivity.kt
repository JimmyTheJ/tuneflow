package dev.tuneflow

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.*
import android.text.InputType
import android.view.*
import android.widget.*
import androidx.media3.common.*
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
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
    private var transport: Button? = null
    private var playingTitle: TextView? = null
    private var currentTracks = listOf<Track>()
    private var tab = "Library"
    private var pageOffset = 0
    private val tick = Handler(Looper.getMainLooper())
    private val background = Color.rgb(16, 23, 24)
    private val surface = Color.rgb(28, 39, 40)
    private val mint = Color.rgb(101, 224, 184)
    private val secondary = Color.rgb(163, 183, 179)
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
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 10)
        if (session.token.isEmpty()) loginScreen() else restore()
        tick.post(pulse)
    }
    private fun restore() {
        frame("Connecting")
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
    private fun frame(title: String) {
        root = box(0); root.setBackgroundColor(background)
        titleView = TextView(this).apply { text = title; textSize = 28f; setTextColor(Color.WHITE); setTypeface(null, Typeface.BOLD); setPadding(dp(20), dp(16), dp(20), dp(12)) }
        root.addView(titleView)
        val scroll = ScrollView(this).apply { isFillViewport = true }
        content = box(); scroll.addView(content)
        root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))
        footer = box(8); root.addView(footer)
        setContentView(root)
    }
    private fun text(value: String, size: Float = 16f, color: Int = Color.WHITE) = TextView(this).apply {
        text = value; textSize = size; setTextColor(color); setPadding(0, dp(5), 0, dp(5))
    }
    private fun label(value: String, target: LinearLayout = content) { target.addView(text(value, 15f, secondary)) }
    private fun action(value: String, target: LinearLayout = content, run: () -> Unit): Button = Button(this).apply {
        text = value; isAllCaps = false; setTextColor(mint); setOnClickListener { run() }
        target.addView(this, LinearLayout.LayoutParams(-1, dp(50)).apply { bottomMargin = dp(6) })
    }
    private fun input(hint: String, initial: String = "", secret: Boolean = false, target: LinearLayout = content) = EditText(this).apply {
        this.hint = hint; setText(initial); setTextColor(Color.WHITE); setHintTextColor(secondary); isSingleLine = true
        if (secret) inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        target.addView(this, LinearLayout.LayoutParams(-1, dp(56)))
    }
    private fun launchWork(block: suspend () -> Unit) { scope.launch { try { block() } catch (e: CancellationException) { throw e } catch (e: Exception) { showError(e) } } }
    private fun showError(e: Exception) { AlertDialog.Builder(this).setTitle("Tuneflow").setMessage(e.message ?: "Request failed").setPositiveButton("OK", null).show() }
    private fun loginScreen() {
        screenJob?.cancel(); frame("Tuneflow")
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
        screenJob?.cancel(); pageOffset = 0; frame(tab)
        val tabs = HorizontalScrollView(this)
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for (name in listOf("Library", "Albums", "Artists", "Playlists", "YouTube", "Settings")) {
            row.addView(Button(this).apply { text = name; isAllCaps = false; setTextColor(if (name == tab) mint else secondary); setOnClickListener { tab = name; home() } })
        }
        tabs.addView(row); root.addView(tabs, 1)
        playerFooter()
        when (tab) {
            "Settings" -> settings()
            "Playlists" -> playlists()
            "Albums" -> albums()
            "Artists" -> artists()
            else -> libraryOrDiscovery()
        }
    }
    private fun playerFooter() {
        playingTitle = text("Choose something to play", 14f); footer.addView(playingTitle)
        progress = SeekBar(this).also { slider ->
            slider.max = 1000; slider.setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar, value: Int, fromUser: Boolean) { if (fromUser) controller?.let { if (it.duration > 0) it.seekTo(it.duration * value / 1000) } }
                override fun onStartTrackingTouch(seekBar: SeekBar) {}
                override fun onStopTrackingTouch(seekBar: SeekBar) {}
            }); footer.addView(slider)
        }
        val controls = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        fun control(label: String, fn: () -> Unit): Button = Button(this).apply { text = label; isAllCaps = false; setTextColor(mint); setOnClickListener { fn() }; controls.addView(this, LinearLayout.LayoutParams(0, dp(48), 1f)) }
        control("Previous") { controller?.seekToPreviousMediaItem() }
        transport = control("Play") { controller?.let { if (it.playerError != null) { it.prepare(); it.play() } else if (it.isPlaying) it.pause() else it.play() } }
        control("Next") { controller?.seekToNextMediaItem() }
        control("Queue") { queue() }
        footer.addView(controls)
    }
    private fun updatePlayer() {
        val p = controller ?: return
        val item = p.currentMediaItem
        playingTitle?.text = when {
            p.playerError != null -> "Playback failed · tap Play to retry"
            item == null -> "Choose something to play"
            p.playbackState == Player.STATE_BUFFERING -> "Loading · ${item.mediaMetadata.title}"
            else -> "${item.mediaMetadata.title} · ${item.mediaMetadata.artist ?: ""}"
        }
        transport?.text = if (p.isPlaying) "Pause" else "Play"
        if (p.duration > 0 && progress?.isPressed != true) progress?.progress = (p.currentPosition * 1000 / p.duration).toInt()
    }
    private fun libraryOrDiscovery() {
        val discovery = tab == "YouTube"
        label(if (discovery) "Supplement your library with YouTube discovery." else "Fast playback from your Jellyfin collection.")
        val query = input(if (discovery) "Search YouTube" else "Search your library")
        val results = box(0); content.addView(results)
        val load: (String, Int) -> Unit = { value, offset ->
            screenJob?.cancel(); results.removeAllViews(); results.addView(text("Loading…", color = secondary))
            screenJob = scope.launch {
                try {
                    val tracks = if (discovery) {
                        val r = api.obj("music/search?source=youtube&q=${Api.encode(value)}&limit=25")
                        r.getJSONArray("groups").objects().map { Track.from(it.getJSONObject("primary")) }
                    } else api.array("library/tracks?q=${Api.encode(value)}&limit=100&offset=$offset").objects().map(Track::from)
                    results.removeAllViews(); currentTracks = tracks
                    if (tracks.isEmpty()) {
                        results.addView(text(if (discovery) "No matches found" else "No tracks found. Link Jellyfin and sync your library in Settings.", color = secondary))
                    }
                    if (tracks.isNotEmpty()) action("Play all", results) { play(tracks, 0) }
                    tracks.forEachIndexed { index, track -> trackRow(results, track) { play(tracks, index) } }
                    if (!discovery) {
                        if (offset > 0) action("Previous page", results) { pageOffset = (offset - 100).coerceAtLeast(0); loadLibraryPage(value, pageOffset, results) }
                        if (tracks.size == 100) action("Next page", results) { pageOffset = offset + 100; loadLibraryPage(value, pageOffset, results) }
                    }
                } catch (e: CancellationException) { throw e } catch (e: Exception) {
                    results.removeAllViews(); results.addView(text(e.message ?: "Could not load music", color = secondary))
                }
            }
        }
        // Insert search above its results; no request is issued per keystroke.
        val search = Button(this).apply { text = "Search"; isAllCaps = false; setOnClickListener { val value = query.text.toString().trim(); if (!discovery || value.isNotEmpty()) load(value, 0) } }
        content.addView(search, content.indexOfChild(results))
        query.setOnEditorActionListener { _, _, _ -> search.performClick(); true }
        if (!discovery) load("", 0)
    }
    private fun loadLibraryPage(query: String, offset: Int, target: LinearLayout) {
        screenJob?.cancel()
        screenJob = scope.launch {
            try {
                val tracks = api.array("library/tracks?q=${Api.encode(query)}&limit=100&offset=$offset").objects().map(Track::from)
                target.removeAllViews(); if (tracks.isNotEmpty()) action("Play all", target) { play(tracks, 0) }
                tracks.forEachIndexed { index, track -> trackRow(target, track) { play(tracks, index) } }
                if (offset > 0) action("Previous page", target) { loadLibraryPage(query, (offset - 100).coerceAtLeast(0), target) }
                if (tracks.size == 100) action("Next page", target) { loadLibraryPage(query, offset + 100, target) }
            } catch (e: CancellationException) { throw e } catch (e: Exception) { showError(e) }
        }
    }
    private fun trackRow(target: LinearLayout, track: Track, onPlay: () -> Unit) {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(8), dp(8), dp(8))
            background = GradientDrawable().apply { setColor(surface); cornerRadius = dp(10).toFloat() }
        }
        val labels = box(0); labels.addView(text(track.title, 17f)); labels.addView(text(if (track.blocked.isEmpty()) track.artist else track.blocked, 13f, secondary))
        row.addView(labels, LinearLayout.LayoutParams(0, -2, 1f)); labels.setOnClickListener { if (track.blocked.isEmpty()) onPlay() }
        row.addView(Button(this).apply { text = "⋮"; setTextColor(mint); setOnClickListener { trackMenu(track) } }, LinearLayout.LayoutParams(dp(50), dp(48)))
        target.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(8) })
    }
    private fun item(track: Track): MediaItem {
        val artworkPath = track.artwork
        val artwork = artworkPath.takeIf { it.isNotEmpty() }?.let { Uri.parse(if (it.startsWith('/')) session.server + it else it) }
        return MediaItem.Builder().setMediaId(track.id).setUri("${session.server}/api/music/audio/${Api.encode(track.id)}")
            .setCustomCacheKey("${session.server}|${session.userId}|${track.id}")
            .setMediaMetadata(MediaMetadata.Builder().setTitle(track.title).setArtist(track.artist).setArtworkUri(artwork).build()).build()
    }
    private fun play(tracks: List<Track>, start: Int) {
        val player = controller ?: run { showError(Exception("Player is connecting; try again")); return }
        val selected = tracks[start]
        if (selected.blocked.isNotEmpty()) { showError(Exception(selected.blocked)); return }
        val playable = tracks.filter { it.blocked.isEmpty() }
        player.setMediaItems(playable.map(::item), playable.indexOf(selected).coerceAtLeast(0), 0)
        player.prepare(); player.play()
        launchWork { api.call("music/prepare", "POST", JSONObject().put("video_ids", JSONArray(playable.drop(start + 1).take(2).map { it.id }))) }
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
        val view = box(); val scroll = ScrollView(this); val rows = box(0); scroll.addView(rows); view.addView(scroll)
        for (i in 0 until p.mediaItemCount) {
            val media = p.getMediaItemAt(i)
            action("${if (i == p.currentMediaItemIndex) "▶ " else ""}${media.mediaMetadata.title}", rows) { p.seekToDefaultPosition(i); p.play() }
        }
        val shuffle = CheckBox(this).apply { text = "Shuffle"; isChecked = p.shuffleModeEnabled; setOnCheckedChangeListener { _, checked -> p.shuffleModeEnabled = checked } }
        rows.addView(shuffle)
        action("Repeat: ${when(p.repeatMode) { Player.REPEAT_MODE_ALL -> "all"; Player.REPEAT_MODE_ONE -> "one"; else -> "off" }}", rows) {
            p.repeatMode = when(p.repeatMode) { Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL; Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE; else -> Player.REPEAT_MODE_OFF }
        }
        action("Clear queue", rows) { p.stop(); p.clearMediaItems() }
        AlertDialog.Builder(this).setTitle("Queue").setView(view).setPositiveButton("Done", null).show()
    }
    private fun albums(offset: Int = 0) {
        if (offset == 0) label("Albums from your Jellyfin library")
        screenJob = scope.launch { try {
            val rows = api.array("library/albums?limit=100&offset=$offset").objects()
            for (album in rows) action("${album.optString("title")} · ${album.optString("artist")}") {
                showTracks(album.optString("title"), "library/tracks?album_id=${Api.encode(album.getString("id"))}&limit=500")
            }
            if (rows.isEmpty() && offset == 0) label("No albums yet. Sync Jellyfin in Settings.")
            if (rows.size == 100) action("More albums") { albums(offset + 100) }
        } catch (e: Exception) { showError(e) } }
    }
    private fun artists(offset: Int = 0) {
        screenJob = scope.launch { try {
            val rows = api.array("library/artists?limit=100&offset=$offset").objects()
            for (artist in rows) action("${artist.optString("name")} · ${artist.optInt("track_count")} tracks") {
                showTracks(artist.optString("name"), "library/tracks?artist=${Api.encode(artist.getString("id"))}&limit=500")
            }
            if (rows.isEmpty() && offset == 0) label("No artists yet. Sync Jellyfin in Settings.")
            if (rows.size == 100) action("More artists") { artists(offset + 100) }
        } catch (e: Exception) { showError(e) } }
    }
    private fun showTracks(title: String, path: String, playlistId: Long? = null) {
        screenJob?.cancel(); content.removeAllViews(); titleView.text = title
        action("Back") { home() }
        screenJob = scope.launch { try {
            val tracks = if (playlistId == null) api.array(path).objects().map(Track::from)
                else api.obj(path).getJSONArray("tracks").objects().filter { !it.isNull("video_id") }.map(Track::from)
            if (tracks.isNotEmpty()) action("Play all") { play(tracks, 0) }
            tracks.forEachIndexed { index, track -> trackRow(content, track) { play(tracks, index) } }
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
        content.removeAllViews(); titleView.text = "Family"; action("Back") { home() }
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
