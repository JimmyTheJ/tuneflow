# Tuneflow

Personal, self-hostable YouTube music player for your household — separate accounts, playlists, history, parental controls, and AI recommendations.

## Stack

- **API**: FastAPI + SQLite + JWT auth
- **Discovery/streams**: [Piped](https://github.com/TeamPiped/Piped) (public instance by default, self-host optional)
- **AI**: OpenAI-compatible LLM API (Ollama, LM Studio, OpenAI, etc. on your LAN or cloud)
- **Mobile**: Expo (React Native) with `expo-av` playback

## Quick start (API)

```powershell
cd D:\workspace\tuneflow
copy .env.example .env
# Edit JWT_SECRET, BOOTSTRAP_* and LLM_BASE_URL

docker compose up --build api
```

API runs at `http://localhost:8000`. Interactive docs at `http://localhost:8000/docs`.

**Schema upgrade:** if you used an older single-user build, delete `data/tuneflow.db` before starting.

### Local Python dev

```powershell
cd services\api
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
mkdir data -Force
copy ..\..\.env.example ..\..\.env
uvicorn app.main:app --reload --port 8000
```

On first startup (or via the mobile setup screen), a **parent** account is created from `BOOTSTRAP_USERNAME` / `BOOTSTRAP_PASSWORD` in `.env`.

## Mobile app

```powershell
cd apps\mobile
npm install
npx expo start
```

1. Set **API URL** in Settings (`http://192.168.x.x:8000` on LAN, or Tailscale).
2. First launch walks through **parent account setup** (or sign in).
3. Each family member signs in with their own username — playlists, history, and likes are per user.

### Phone ↔ server networking

| Scenario | API URL example |
|----------|-----------------|
| Android emulator | `http://10.0.2.2:8000` |
| Same Wi‑Fi | `http://192.168.1.50:8000` |
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
# In .env: PIPED_BASE_URL=http://piped-backend:8080
docker compose --profile piped up --build
```

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
