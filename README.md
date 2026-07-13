# Tuneflow

Personal, self-hostable YouTube music player for your household — separate accounts, playlists, history, parental controls, and AI recommendations.

## Stack

- **API**: FastAPI + SQLite + JWT auth
- **Discovery/streams**: [Piped](https://github.com/TeamPiped/Piped) (public instance by default, self-host optional)
- **AI**: OpenAI-compatible LLM API (Ollama, LM Studio, OpenAI, etc. on your LAN or cloud)
- **Mobile**: Expo (React Native) with `expo-av` playback
- **Web**: React + Vite browser app for Windows/Linux/macOS desktops

## Quick start (API)

```powershell
cd D:\workspace\tuneflow
copy .env.example .env
# Edit JWT_SECRET, BOOTSTRAP_* and LLM_BASE_URL

.\compose.ps1 up --build tuneflow-api
```

API runs at `http://localhost:8010` by default. Interactive docs at `http://localhost:8010/docs`.

> **Port conflicts?** Defaults avoid common ports (8000, 5173). Override anytime:
> `uvicorn app.main:app --port 8020` and `WEB_PORT=5195 npm run dev`

**Schema upgrade:** if you used an older single-user build, delete `data/tuneflow.db` before starting.

### Local Python dev

```powershell
cd services\api
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
mkdir data -Force
copy ..\..\.env.example ..\..\.env
uvicorn app.main:app --reload --port 8010
```

On first startup, the setup wizard creates a **local parent account** (username + password stored in Tuneflow). This is required before LDAP or other external auth can be wired in later.

Optional: set `BOOTSTRAP_ENABLED=true` in `.env` to auto-create the first account from `BOOTSTRAP_USERNAME` / `BOOTSTRAP_PASSWORD` for headless installs.

### Exposing to the internet

For a public subdomain, at minimum:

1. Put TLS termination in front (Caddy, nginx, Traefik).
2. Set `JWT_SECRET` to a long random value.
3. Set `TRUST_PROXY_HEADERS=true` so rate limits use real client IPs.
4. Restrict `CORS_ORIGINS` to your web UI origin.
5. Set `DOCS_ENABLED=false` in production.
6. Login/setup/PIN endpoints are rate-limited by default (10 failed logins per 15 min per IP and username).

## Web app (desktop browser)

Works on **Windows, Linux, and macOS** in any modern browser — same features as mobile.

### Development

```powershell
# Terminal 1 — API
cd D:\workspace\tuneflow\services\api
.\.venv\Scripts\uvicorn.exe app.main:app --reload --port 8010

# Terminal 2 — Web UI
cd D:\workspace\tuneflow\apps\web
npm install
npm run dev
```

Open **http://localhost:5190**. The default API URL is `http://localhost:8010` (change in Settings if you used a different API port).

### Docker (API + web together)

```powershell
cd D:\workspace\tuneflow
.\compose.ps1 up --build tuneflow-api tuneflow-web
```

On Linux/macOS, use `./compose.sh` instead of `.\compose.ps1`.

| Service | URL |
|---------|-----|
| Web UI | http://localhost:3010 |
| API | http://localhost:8010 |
| API docs | http://localhost:8010/docs |

Override host ports in `.env`: `API_PORT=8020`, `WEB_PORT=3020`.

Set `VITE_API_URL` in `.env` before building if the browser needs a different API address (e.g. LAN IP). For a single public subdomain behind a reverse proxy, leave it empty so the browser uses same-origin `/api` (the web container proxies those requests to `tuneflow-api`).

To attach API and web to an existing reverse-proxy network (e.g. nginx), set `DOCKER_SHARED_NETWORK=nginx_network` in `.env` and use `compose.ps1` / `compose.sh` (not bare `docker compose` — the wrapper reads `.env` and includes the shared-network overlay). The network must already exist.

Verify with `./compose.sh config | grep -A2 'networks:'` — you should see both the project default network and `name: nginx_network`.

### Nginx Proxy Manager (or similar)

A **502** here almost always means the proxy cannot reach the upstream container — not a DNS/DDNS issue. Your other subdomains working only proves NPM itself is fine; this proxy host still needs the Tuneflow-specific container name and internal port.

**Proxy Host settings (one host for the UI):**

| Field | Value |
|-------|-------|
| Domain | `music.example.com` (your subdomain) |
| Scheme | `http` |
| Forward Hostname / IP | `tuneflow-web` |
| Forward Port | `80` |
| Block Common Exploits | on (usually fine) |
| Websockets Support | off (not required) |

Common mistakes that cause 502:

- Forwarding to `web`, `api`, or `localhost` instead of `tuneflow-web`
- Using host port `3010` instead of container port `80` (`3010` is only for browser → host access)
- Using `https` to the upstream (the Tuneflow web container only serves plain HTTP on port 80)
- NPM container not attached to the same Docker network as Tuneflow

**Run these on the server** (replace the NPM container name if yours differs — find it with `docker ps | grep -i proxy`):

```bash
# Tuneflow containers should appear here
docker network inspect nginx_network --format '{{range .Containers}}{{.Name}} {{end}}'

# Test from inside NPM — this is the same path NPM uses
docker exec nginx-proxy-manager curl -sv http://tuneflow-web:80/ 2>&1 | head -20
docker exec nginx-proxy-manager curl -sv http://tuneflow-web/health 2>&1 | head -20

# Tuneflow container health
docker ps --filter name=tuneflow-
docker logs --tail 50 tuneflow-web
docker logs --tail 50 tuneflow-api
```

If the `curl` from inside NPM fails, fix Docker networking or container names first. If `curl` works but the browser still shows 502, the NPM proxy host forward settings are wrong (or stale — edit, save, and try again).

NPM error details are often in per-host log files inside the container (`/data/logs/`), not in `docker logs nginx_proxy_manager`.

**After the UI loads**, set production values in `.env` and rebuild:

```env
VITE_API_URL=
CORS_ORIGINS=https://music.example.com
TRUST_PROXY_HEADERS=true
JWT_SECRET=<long-random-secret>
DOCS_ENABLED=false
```

Then `./compose.sh up -d --build tuneflow-web tuneflow-api`.

Optional second proxy host for direct API access (debugging only): forward `tuneflow-api:8000` over `http`.

### Persistent data (Docker)

The API runs as a non-root user (default uid/gid **10001**). Data lives at `TUNEFLOW_DATA_HOST_PATH` on the host, mounted to `/app/data` in the container.

**Named volume (default)** — no setup needed; Docker manages `tuneflow-data`.

**Bind mount** (e.g. `/home/jamus/tuneflow-data`):

```env
TUNEFLOW_DATA_HOST_PATH=/home/jamus/tuneflow-data
```

```bash
mkdir -p /home/jamus/tuneflow-data
sudo chown -R 10001:10001 /home/jamus/tuneflow-data
./compose.sh up --build -d
```

To have files owned by your login user on the host instead, set `PUID` and `PGID` in `.env` to the output of `id -u` and `id -g`, rebuild, and `chown` the data directory to match.

Avoid NTFS/exFAT mounts (e.g. `/mnt/d/...` from Windows drives) if you hit permission errors — use a native Linux path under `/home` or `/var/lib`.

If you upgraded from an older root-owned data directory: `sudo chown -R 10001:10001 /path/to/data`.

## Mobile app

```powershell
cd apps\mobile
npm install
npx expo start
```

1. Set **API URL** in Settings (`http://192.168.x.x:8010` on LAN, or Tailscale).
2. First launch walks through **parent account setup** (or sign in).
3. Each family member signs in with their own username — playlists, history, and likes are per user.

### Android dev APK

Local debug builds use auto-incrementing versions stored under `%USERPROFILE%\.tuneflow-mobile-dev\` (same idea as [jellyfin-android](https://github.com/jellyfin/jellyfin-android)):

| File | Purpose |
|------|---------|
| `version.properties` | Version for the **next** dev build (e.g. `0.1.0-dev.3`) |
| `last-build.properties` | Metadata for the most recent APK (path, git commit, etc.) |

Requires **Android Studio** command-line tools (or an existing SDK install). On first run the script bootstraps a writable SDK at `%USERPROFILE%\.tuneflow-android-sdk\` (platform tools, build-tools, CMake, NDK) so it does not need to write into `Program Files`.

```powershell
cd apps\mobile
npm install
npm run dev:apk
```

Output: `apps\mobile\android\app\build\outputs\apk\debug\tuneflow-v<version>-debug.apk`

Each successful build bumps the dev suffix (`0.1.0-dev.2` → `0.1.0-dev.3`) in your user profile, not in git.

### Phone ↔ server networking

| Scenario | API URL example |
|----------|-----------------|
| Android emulator | `http://10.0.2.2:8010` |
| Same Wi‑Fi | `http://192.168.1.50:8010` |
| Tailscale | `http://100.x.x.x:8000` |

## Family accounts

| Role | Capabilities |
|------|----------------|
| **parent** | Manage child accounts, parental controls, view all settings |
| **adult** | Full personal library, search, AI discover |
| **child** | Personal library, subject to parental rules |

Parents create accounts in the app via **Settings → Family members**, or via API:

```json
POST /api/users
{
  "username": "kid1",
  "password": "their-pin",
  "display_name": "Alex",
  "role": "child"
}
```

Each family member signs in with their own username — libraries stay separate.

### Parent PIN (shared devices)

Parents set a PIN under **Settings → Parent PIN**. When set, child accounts must enter it to switch accounts or sign out. If no PIN is configured, children can switch freely.

## Parental controls (child accounts)

Configured by parents in **Settings → Parental controls** (Controls + History tabs):

- Block explicit content (keyword filter)
- Custom blocked keywords and video IDs
- Disable search
- Daily listening limit (minutes) with usage dashboard
- Allowed listening hours (server local time)
- Per-child play history view

Search results for blocked content show as unavailable; streams are rejected server-side.

## AI / LLM setup

Tuneflow calls any **OpenAI-compatible** chat API. Works with:

| Provider | Example `LLM_BASE_URL` |
|----------|------------------------|
| **Ollama** (LAN) | `http://192.168.1.100:11434/v1` |
| **LM Studio** | `http://192.168.1.100:1234/v1` |
| **OpenAI** | `https://api.openai.com/v1` |

```env
LLM_ENABLED=true
LLM_BASE_URL=http://192.168.1.100:11434/v1
LLM_API_KEY=          # leave blank for Ollama
LLM_MODEL=llama3.2
```

The LLM does **not** need to run on the same machine as the API — only on a reachable LAN IP.

Mobile **Discover** tab:
- `GET /api/ai/insights` — listening patterns summary
- `GET /api/ai/recommendations` — personalized song suggestions (LLM proposes searches, server resolves tracks via Piped)

Check connectivity: `GET /api/ai/status`

## Self-hosted Piped (optional)

```powershell
# In .env: PIPED_BASE_URL=http://tuneflow-piped:8080
.\compose.ps1 --profile piped up --build
```

`PIPED_BASE_URL` uses the container port (`8080`) on the Docker network. Override the **host** port with `PIPED_PORT` in `.env` if `8080` clashes on your machine.

## API overview

Authenticated routes use `Authorization: Bearer <jwt>`.

| Endpoint | Description |
|----------|-------------|
| `GET /api/auth/setup-status` | Whether first-time setup is needed |
| `POST /api/auth/setup` | Create first parent account |
| `POST /api/auth/login` | Sign in |
| `GET /api/auth/me` | Current user |
| `GET/POST /api/users` | List/create family accounts (parent) |
| `GET/PUT /api/parental/{child_id}/settings` | Parental controls |
| `GET /api/parental/{child_id}/usage` | Child's listening time today |
| `GET /api/parental/{child_id}/history` | Child's play history (parent) |
| `PUT /api/auth/parent-pin` | Set parent PIN |
| `GET /api/auth/parent-pin/enforced` | Whether PIN is required for child exit |
| `POST /api/auth/verify-parent-pin` | Verify parent PIN |
| `GET /api/ai/status` | LLM connectivity |
| `GET /api/ai/insights` | AI listening analysis |
| `GET /api/ai/recommendations` | AI music suggestions |
| `GET /api/music/search?q=` | Search songs |
| `GET /api/music/stream/{video_id}` | Resolve audio stream URL |
| `GET/POST /api/playlists` | Per-user playlists |
| `GET/POST /api/history` | Per-user play history |
| `GET/POST/DELETE /api/likes` | Per-user likes |

## Personal use note

This project wraps YouTube for personal household listening. It is not a licensed music service and is not intended for public distribution.
