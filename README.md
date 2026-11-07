# Tuneflow

A self-hosted household music player. Jellyfin manages your music collection;
Tuneflow indexes it and plays the audio in its own web and native Android players.
YouTube is a separate, supplemental discovery source.

## Applications

| Component | Implementation | Location |
| --- | --- | --- |
| Server | Rust, Axum, Tokio, SQLx, SQLite/FTS5 | `services/server` |
| Android | Native Kotlin, Android Views, Media3/ExoPlayer | `apps/android` |
| Web | Existing TypeScript/React interface, retained for now | `apps/web` |

The Python API and Expo app remain in `services/api` and `apps/mobile` as migration
references. Docker Compose now builds the Rust server. Neither legacy application
is part of the new server or native Android runtime. YouTube extraction uses the
external `yt-dlp` executable; its Python implementation is not reimplemented in Rust.

## Run with Docker

1. Copy `.env.example` to `.env` and set `JWT_SECRET` to a private value of at least
   32 bytes. Retain your existing secret when migrating an existing installation.
2. Set `JELLYFIN_URL` to your trusted Jellyfin server's base URL, including any
   subpath. This is both the allowed linking address and the default shown in
   Settings, not a shared Jellyfin administrator credential. Add other trusted
   addresses to `JELLYFIN_ALLOWED_URLS` if needed.
3. Run:

```bash
./compose.sh up -d --build tuneflow-api tuneflow-web
```

The API uses port **8010**, and the web app uses **3010** by default. The runtime
image includes yt-dlp, its challenge components, Deno, and FFmpeg. It does not
require Piped or rotate through public Piped instances.

Both host ports bind to `127.0.0.1` by default so plain HTTP is reachable only
from the server itself. If your TLS proxy runs on another host, set
`WEB_HOST_BIND` to the server's private network address and restrict that port
with a firewall. The API normally stays on loopback or the shared Docker network.

Use a TLS reverse proxy for remote access. For one public hostname, leave
`VITE_API_URL` and `CORS_ORIGINS` empty. Set `CORS_ORIGINS` to the web origin
only when the browser reaches the API at a separate origin. The web container
proxies `/api` to `tuneflow-api:8000`. Existing `compose.sh`/`compose.ps1` shared
network support and persistent-data volume settings remain available.
Release Android builds require HTTPS for the Tuneflow server. Debug builds allow
HTTP for local development.

### First use

1. Set up the initial administrator in the app or browser. Its household is `system`.
2. Create a household and its administrator from Settings. Sign in to that household
   to manage family members; the system account is for server administration.
3. In Settings, link each Tuneflow user to their own Jellyfin account and sync.
4. Browse or search the indexed library. Select **YouTube** explicitly when you
   want to discover tracks outside your collection.

**Your Library** has Artists, Albums, Songs, and Playlists tabs. Each has Large
tiles, List, and Details views; the choice is saved separately for each tab.
Open an artist to browse their albums and songs, or open an album for its tracklist.
Play all on an artist or album replaces the queue with that selection; selecting
a song plays only that song. Album playback uses disc and track order. If you
synced before this browsing update, run **Sync library** again in Settings to
fill in album artist and track numbers from Jellyfin.
The Android artist and album screens page their results; playback loads the
complete queue only when requested. If Android says the server is too old for
artist search, rebuild and restart `tuneflow-api` from the current checkout.
Tracks with an album name but no Jellyfin album ID are grouped by name and
album artist. Android resolves YouTube audio before starting Media3 playback;
an upstream extraction failure is shown directly in the app.

Android's expanded Now Playing panel scrolls into two upcoming queues. Explicit
requests (**Play next** or **Add to your queue**) play before the remaining
playlist, album, artist or search **Play all** selection. Completed tracks leave
the queue; hold and drag to reorder within either section, or tap × to remove.
Repeat playlist cycles the background selection; manual requests are consumed
once. Repeat track loops the current song. Shuffle playlist rearranges only
upcoming background tracks. Starting another context retains manual requests.

YouTube searches submit from the search icon or keyboard. Recent searches and
fuzzy history suggestions appear as you type; library searches still run after
300 ms. YouTube results persist across navigation by default; Settings can clear
them when leaving YouTube. The × next to Search clears the current search and
results; **Clear history** removes saved queries. State is local to each account
and server. A track's ⋮ → **Info** shows its full title, upload metadata when
available, and a YouTube link with open/copy actions. Home shows recent listening
and playlists rather than repeating the navigation menu.

Android retains five-second Media3 preloading and prepares the next two YouTube
stream URLs, including after queue edits. Playback starts from the streamed
response; it does not wait for a whole-track download.

Jellyfin passwords are used only for authentication. The resulting access token
is encrypted at rest using a key derived from `JWT_SECRET` and never sent to clients.
Library indexing is scoped to the linked Jellyfin user. Playback remains in Tuneflow,
with Jellyfin serving the bytes upstream. The original library files stay in Jellyfin.

## Existing installations

Stop the old API before starting the Rust service against the same database.
Keep the same data volume and `JWT_SECRET`. Current accounts, bcrypt passwords,
households, roles, playlists, likes, listening history, and equalizer profiles are
read directly from the existing schema.

The ignored `.env` file is not updated by Git. Before starting Compose, merge
the tracked `.env.example` into your server's `.env`: preserve the real
`JWT_SECRET`, set `JELLYFIN_URL` (and any other allowed Jellyfin addresses),
clear the old localhost `VITE_API_URL`, and remove obsolete `PIPED_*`,
`POSTGRES_*`, bootstrap, and Python-only settings. Leave `CORS_ORIGINS` empty
when the browser uses the web container's `/api` proxy. The Rust server ignores
a wildcard CORS value; use explicit origins if the browser reaches the API
separately. Rebuild the web image after changing `VITE_API_URL`.

Some old column defaults existed only in Python. The Rust server migrates those
tables transactionally and retains a complete `tuneflow-before-rust-*.db` backup
in the data directory. Unknown columns cause startup to fail instead of silently
removing data. Keep the backup until you have verified your installation.
Do not run the Python and Rust APIs concurrently against the same database.

A linked Jellyfin library requires a new sync. Existing YouTube IDs and playlists
remain usable. Spotify imports first match tracks in your library; unmatched
recordings remain explicitly unmatched rather than being silently substituted.

## Local Rust development

Install a Rust toolchain supporting edition 2024, yt-dlp with its default extras,
and Deno. FFmpeg is useful for media tooling. Then, from the repository root:

```bash
# .env is loaded from the working directory.
cargo run --manifest-path services/server/Cargo.toml
```

Important environment settings:

| Variable | Default / purpose |
| --- | --- |
| `JWT_SECRET` | Required, at least 32 bytes; also protects linked Jellyfin tokens |
| `TUNEFLOW_DATA_DIR` | `data`; database, media cache, migration backups |
| `BIND_ADDRESS` | `0.0.0.0:8000` |
| `JELLYFIN_URL` | Trusted Jellyfin address and per-user linking default |
| `JELLYFIN_ALLOWED_URLS` | Additional trusted Jellyfin addresses, comma separated |
| `YTDLP_BIN` | `yt-dlp` |
| `CORS_ORIGINS` | Empty (same-origin); set explicit browser origins if needed |
| `RUST_LOG` | Request and provider diagnostics without credential-bearing URLs |

The native server uses port 8000 unless overridden; set `BIND_ADDRESS=0.0.0.0:8010`
when using the web app's local development proxy.

```bash
npm --prefix apps/web install
npm --prefix apps/web run dev
```

## Native Android

Open `apps/android` in Android Studio, or use JDK 21 and an Android SDK containing
platform 37 and build-tools 36.0.0:

```bash
cd apps/android
./gradlew assembleDebug testDebugUnitTest lintDebug
```

The application ID is `com.tuneflow.app`. Updating an existing installation requires
an APK signed by the same key. The native client stores its own encrypted session;
an Expo login is not imported. Debug APKs contain everything needed to launch and
do not depend on Metro, Node, or an embedded browser.

`scripts/build-android.sh` builds, checks, and copies a descriptively named APK to
`/mnt/d/Users/jamus/Nextcloud/APKs`, verifying its SHA-256 checksum. The original
Gradle build output and a descriptive local copy are retained.

The player uses a MediaSessionService, audio focus, headphone-disconnect handling,
lock-screen/notification controls, a 512 MiB disk cache per Tuneflow account, and
next-item preloading. Playback begins after buffering instead of downloading a
whole song. The disk cache is opportunistic; it is not a user-managed offline
library or a guarantee that every queued track is available without the server.

## Playback and discovery design

- Local FTS5 search does not contact YouTube or MusicBrainz.
- Library scans run in the background and replace the index only after a complete
  successful scan. Failed scans retain the previous library. Connections are
  refreshed by the hourly maintenance worker, or by explicit sync.
- Jellyfin streams retain byte ranges, response status, lengths, and media types.
  Playback verifies current access to the linked Jellyfin item.
- YouTube uses one audio extraction, shared by concurrent requests and reused for
  three minutes. Search results are cached for two minutes. Repeated extraction
  failures cool down for ten seconds. At most three extractors run concurrently.
- Ordinary YouTube search has a ten-second deadline; audio resolution has a
  twenty-five-second deadline, including waiting for an extractor slot. Cancellation
  kills the extractor subprocess. Audio playback does not wait for video lookup.
- Compose runs a private PO token provider alongside the API. The Rust server
  gives its URL to yt-dlp, which uses the matching plugin in the API image.
  Media requests follow up to five CDN redirects, preserving seeking ranges.
  Expired CDN links are resolved once more before playback fails. Provider
  HTTP failures include the upstream status in the app and server log.
- The server forwards audio immediately and writes completed cache files atomically.
  Interrupted or oversized downloads do not become playable server cache entries.
- Catalog metadata and AI recommendations stay outside the playback path. Official
  uploads are preferred using inexpensive result metadata, without per-result probes.
- Recordings are not silently replaced with covers or alternate uploads after failure.
  YouTube extraction remains dependent on upstream availability and restrictions.

The existing web interface has only compatibility changes: Jellyfin linking,
Library/YouTube source selection, artwork support, and working request cancellation.
A broader web redesign is deferred.

## Validation

```bash
cargo fmt --manifest-path services/server/Cargo.toml --check
cargo clippy --manifest-path services/server/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path services/server/Cargo.toml
npm --prefix apps/web run build
```

Rust integration tests cover database migration, account/household isolation,
scoped media tokens, idempotent listening progress, Jellyfin indexing and permissions,
range forwarding, progressive first-byte delivery, and shared YouTube extraction.
Provider tests use local mock servers and do not need a real Jellyfin account.

For the Android playback, queue and discovery UI tests, start the synthetic fixture in one terminal:

```bash
cargo run --manifest-path services/server/Cargo.toml --example playback_fixture
```

With a local emulator connected:

```bash
adb reverse tcp:18010 tcp:18010
cd apps/android
./gradlew connectedDebugAndroidTest
```

The fixture uses loopback ports 18010 and 18011 and a synthetic extractor; no real
YouTube or Jellyfin account is used. Tests check search persistence, fuzzy history,
full track information, long-press queue dragging, foreground priority and consumption,
startup, seeking, queue advancement, and
background playback. It uses temporary data under the system temp directory and
never accesses a real Jellyfin library. See [the architecture notes](docs/architecture.md)
for the API and operational details.
