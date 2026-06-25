# Tuneflow

Personal, self-hostable YouTube music player with playlists, history, and likes.

## Stack

- **API**: FastAPI + SQLite
- **Discovery/streams**: [Piped](https://github.com/TeamPiped/Piped) (public instance by default, self-host optional)
- **Mobile**: Expo (React Native) with `expo-av` playback

## Quick start (API)

```powershell
cd D:\workspace\tuneflow
copy .env.example .env
# Edit .env and set TUNEFLOW_API_TOKEN

docker compose up --build api
```

API runs at `http://localhost:8000`. Docs at `http://localhost:8000/docs`.

### Local Python dev (without Docker)

```powershell
cd services\api
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
mkdir ..\..\data
copy ..\..\.env.example ..\..\.env
$env:DATABASE_URL="sqlite+aiosqlite:///./data/tuneflow.db"
uvicorn app.main:app --reload --port 8000
```

## Mobile app

```powershell
cd apps\mobile
npm install
npx expo start
```

1. Open the app on your phone with Expo Go (or a dev build).
2. Go to **Settings** and set:
   - **API URL** — your server address (`http://192.168.x.x:8000` on LAN, or Tailscale IP)
   - **API token** — same value as `TUNEFLOW_API_TOKEN` in `.env`

Then use **Search** to find music and play it. History and playlists sync to your server.

### Phone ↔ PC networking tips

| Scenario | API URL example |
|----------|-----------------|
| Android emulator | `http://10.0.2.2:8000` |
| Same Wi‑Fi | `http://192.168.1.50:8000` |
| Tailscale | `http://100.x.x.x:8000` |

## Self-hosted Piped (optional)

By default the API uses a public Piped instance. To run your own:

```powershell
# In .env:
# PIPED_BASE_URL=http://piped-backend:8080

docker compose --profile piped up --build
```

For a full production Piped deployment (PostgreSQL, proxy, etc.), see the [official Piped docs](https://github.com/TeamPiped/Piped).

## API overview

All `/api/*` routes require `Authorization: Bearer <TUNEFLOW_API_TOKEN>`.

| Endpoint | Description |
|----------|-------------|
| `GET /api/music/search?q=` | Search songs |
| `GET /api/music/stream/{video_id}` | Resolve audio stream URL |
| `GET/POST /api/playlists` | List/create playlists |
| `GET /api/playlists/{id}` | Playlist with tracks |
| `POST /api/playlists/{id}/tracks` | Add track |
| `GET/POST /api/history` | Play history |
| `GET/POST/DELETE /api/likes` | Liked songs |

## Roadmap

- [ ] Like button in player UI
- [ ] Add-to-playlist picker from search
- [ ] `react-native-track-player` dev build for richer lock-screen controls
- [ ] YouTube playlist import by URL
- [ ] Simple recommendations from play history

## Personal use note

This project wraps YouTube for personal listening. It is not a licensed music service and is not intended for public distribution.
