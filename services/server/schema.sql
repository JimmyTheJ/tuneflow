-- Compatible with the existing SQLAlchemy schema. New databases receive SQL defaults.

-- Existing tables and rows are retained; no destructive migrations.

CREATE TABLE IF NOT EXISTS households (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 0,
  search_defaults_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(slug)
);

CREATE TABLE IF NOT EXISTS role_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT,
  owner_household_id INTEGER NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  is_global INTEGER NOT NULL DEFAULT 0,
  is_public INTEGER NOT NULL DEFAULT 0,
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_role_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_profile_id INTEGER NOT NULL REFERENCES role_profiles(id) ON DELETE CASCADE,
  UNIQUE(user_id,role_profile_id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  household_id INTEGER REFERENCES households(id) ON DELETE SET NULL,
  is_root_admin INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  parent_pin_hash TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(household_id,username)
);

CREATE TABLE IF NOT EXISTS user_channel_pins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  artist_key TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,artist_key)
);

CREATE TABLE IF NOT EXISTS parental_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  child_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  block_explicit INTEGER NOT NULL DEFAULT 1,
  search_enabled INTEGER NOT NULL DEFAULT 1,
  max_daily_minutes INTEGER,
  allowed_start_hour INTEGER NOT NULL DEFAULT 0,
  allowed_end_hour INTEGER NOT NULL DEFAULT 23,
  blocked_keywords TEXT NOT NULL DEFAULT '[]',
  blocked_video_ids TEXT NOT NULL DEFAULT '[]',
  search_advanced_hidden INTEGER NOT NULL DEFAULT 0,
  search_locked INTEGER NOT NULL DEFAULT 0,
  search_max_versions_ceiling INTEGER,
  search_force_clean INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  source_type TEXT NOT NULL DEFAULT 'manual',
  source_url TEXT,
  source_external_id TEXT,
  import_job_id INTEGER,
  deleted_at TEXT,
  deleted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  video_id TEXT,
  title TEXT NOT NULL,
  artist TEXT,
  thumbnail_url TEXT,
  duration_sec INTEGER,
  position INTEGER NOT NULL DEFAULT 0,
  match_status TEXT NOT NULL DEFAULT 'matched',
  match_score INTEGER,
  source_title TEXT,
  source_artist TEXT,
  source_duration_ms INTEGER,
  source_spotify_id TEXT,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  source_url TEXT,
  source_external_id TEXT,
  requested_name TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  progress_done INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  error TEXT,
  result_playlist_id INTEGER,
  options_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS play_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT,
  thumbnail_url TEXT,
  duration_sec INTEGER,
  listened_sec INTEGER,
  played_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scrobbler_connections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  username TEXT NOT NULL,
  session_key TEXT NOT NULL,
  scrobbling_enabled INTEGER NOT NULL DEFAULT 1,
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,provider)
);

CREATE TABLE IF NOT EXISTS likes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT,
  thumbnail_url TEXT,
  duration_sec INTEGER,
  liked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,video_id)
);

CREATE TABLE IF NOT EXISTS system_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_enabled INTEGER NOT NULL DEFAULT 1,
  cache_retention_days INTEGER,
  cache_refresh_days INTEGER NOT NULL DEFAULT 180,
  cache_max_size_mb INTEGER,
  cache_cleanup_interval_hours INTEGER NOT NULL DEFAULT 24,
  catalog_cache_retention_days INTEGER DEFAULT 7,
  catalog_cache_max_size_mb INTEGER,
  playlist_retention_days INTEGER NOT NULL DEFAULT 90,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audio_cache_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id TEXT NOT NULL UNIQUE,
  file_path TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_verified_at TEXT,
  cached_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title TEXT,
  artist TEXT,
  thumbnail_url TEXT,
  duration_sec INTEGER,
  has_video INTEGER NOT NULL DEFAULT 0,
  video_mime_type TEXT
);

CREATE TABLE IF NOT EXISTS catalog_cache_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cache_key TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  cached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eq_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  bands_json TEXT NOT NULL,
  preamp_db REAL NOT NULL DEFAULT 0.0,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS eq_track_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  eq_profile_id INTEGER NOT NULL REFERENCES eq_profiles(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,video_id)
);

CREATE TABLE IF NOT EXISTS eq_playlist_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  eq_profile_id INTEGER NOT NULL REFERENCES eq_profiles(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,playlist_id)
);

CREATE TABLE IF NOT EXISTS audio_cache_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,
  cache_entry_id INTEGER NOT NULL REFERENCES audio_cache_entries(id) ON DELETE CASCADE,
  first_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_accessed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id,video_id)
);

CREATE INDEX IF NOT EXISTS idx_history_user_time ON play_history(user_id, played_at);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order ON playlist_tracks(playlist_id,position);

CREATE TABLE IF NOT EXISTS jellyfin_connections (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 server_url TEXT NOT NULL, remote_user_id TEXT NOT NULL, token_ciphertext TEXT NOT NULL,
 display_name TEXT NOT NULL, synced_at TEXT, sync_error TEXT
);

CREATE TABLE IF NOT EXISTS library_tracks (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 item_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT, album TEXT, album_id TEXT,
 duration_sec INTEGER, container TEXT, image_id TEXT, explicit INTEGER NOT NULL DEFAULT 0,
 recording_mbid TEXT, generation TEXT NOT NULL, PRIMARY KEY(user_id,item_id)
);

CREATE INDEX IF NOT EXISTS idx_library_album ON library_tracks(user_id,album_id);

CREATE INDEX IF NOT EXISTS idx_library_artist ON library_tracks(user_id,artist);

-- Library search never performs network lookups. FTS5 indexes recording metadata.
CREATE VIRTUAL TABLE IF NOT EXISTS library_fts USING fts5(title,artist,album,content='library_tracks',content_rowid='rowid');
CREATE TRIGGER IF NOT EXISTS library_fts_insert AFTER INSERT ON library_tracks BEGIN
 INSERT INTO library_fts(rowid,title,artist,album) VALUES(new.rowid,new.title,new.artist,new.album);
END;
CREATE TRIGGER IF NOT EXISTS library_fts_delete AFTER DELETE ON library_tracks BEGIN
 INSERT INTO library_fts(library_fts,rowid,title,artist,album) VALUES('delete',old.rowid,old.title,old.artist,old.album);
END;
CREATE TRIGGER IF NOT EXISTS library_fts_update AFTER UPDATE ON library_tracks BEGIN
 INSERT INTO library_fts(library_fts,rowid,title,artist,album) VALUES('delete',old.rowid,old.title,old.artist,old.album);
 INSERT INTO library_fts(rowid,title,artist,album) VALUES(new.rowid,new.title,new.artist,new.album);
END;

-- One history row per native listening session; progress updates are idempotent.
CREATE TABLE IF NOT EXISTS listening_sessions (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 session_id TEXT NOT NULL,
 history_id INTEGER NOT NULL REFERENCES play_history(id) ON DELETE CASCADE,
 UNIQUE(user_id,session_id)
);
