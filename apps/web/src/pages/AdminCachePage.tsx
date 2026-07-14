import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import type { CacheEntry, CacheSettings, CacheStats, User } from "@/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function AdminCachePage() {
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [settings, setSettings] = useState<CacheSettings | null>(null);
  const [entries, setEntries] = useState<CacheEntry[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [retentionDays, setRetentionDays] = useState("");
  const [refreshDays, setRefreshDays] = useState("180");
  const [maxSizeMb, setMaxSizeMb] = useState("");
  const [cleanupHours, setCleanupHours] = useState("24");
  const [filterUserId, setFilterUserId] = useState("");
  const [purgeUserId, setPurgeUserId] = useState("");
  const [purgeOlderDays, setPurgeOlderDays] = useState("");
  const [catalogRetentionDays, setCatalogRetentionDays] = useState("7");
  const [catalogMaxSizeMb, setCatalogMaxSizeMb] = useState("");
  const [playlistRetentionDays, setPlaylistRetentionDays] = useState("90");
  const [purgeCatalogOlderDays, setPurgeCatalogOlderDays] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const [nextStats, nextSettings, nextEntries, nextUsers] = await Promise.all([
      api.cacheStats(),
      api.getCacheSettings(),
      api.listCacheEntries(filterUserId ? Number(filterUserId) : undefined),
      api.listUsers(),
    ]);
    setStats(nextStats);
    setSettings(nextSettings);
    setEntries(nextEntries);
    setUsers(nextUsers);
    setSelectedVideoIds(new Set());
    setRetentionDays(
      nextSettings.cache_retention_days == null ? "" : String(nextSettings.cache_retention_days),
    );
    setRefreshDays(String(nextSettings.cache_refresh_days));
    setMaxSizeMb(nextSettings.cache_max_size_mb == null ? "" : String(nextSettings.cache_max_size_mb));
    setCleanupHours(String(nextSettings.cache_cleanup_interval_hours));
    setCatalogRetentionDays(
      nextSettings.catalog_cache_retention_days == null
        ? ""
        : String(nextSettings.catalog_cache_retention_days),
    );
    setCatalogMaxSizeMb(
      nextSettings.catalog_cache_max_size_mb == null ? "" : String(nextSettings.catalog_cache_max_size_mb),
    );
    setPlaylistRetentionDays(String(nextSettings.playlist_retention_days));
  }, [filterUserId]);

  useEffect(() => {
    if (user?.is_root_admin !== true) return;
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load cache"));
  }, [load, user?.is_root_admin]);

  if (user?.is_root_admin !== true) {
    return (
      <div className="page">
        <h1>Cache management</h1>
        <p className="muted">Admin access required.</p>
        <Link to="/settings" className="accent">
          Back to settings
        </Link>
      </div>
    );
  }

  const saveSettings = async () => {
    setError(null);
    try {
      const updated = await api.updateCacheSettings({
        cache_enabled: settings?.cache_enabled,
        cache_retention_days: retentionDays.trim() === "" ? null : Number(retentionDays),
        cache_refresh_days: Number(refreshDays),
        cache_max_size_mb: maxSizeMb.trim() === "" ? null : Number(maxSizeMb),
        cache_cleanup_interval_hours: Number(cleanupHours),
        catalog_cache_retention_days:
          catalogRetentionDays.trim() === "" ? null : Number(catalogRetentionDays),
        catalog_cache_max_size_mb: catalogMaxSizeMb.trim() === "" ? null : Number(catalogMaxSizeMb),
        playlist_retention_days: Number(playlistRetentionDays),
      });
      setSettings(updated);
      setMessage("Cache settings saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings");
    }
  };

  const runCleanup = async () => {
    setError(null);
    try {
      const result = await api.runCacheCleanup();
      setMessage(`Cleanup removed ${result.deleted_entries} entries (${formatBytes(result.freed_bytes)} freed)`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Cleanup failed");
    }
  };

  const clearAll = async () => {
    if (!window.confirm("Delete the entire audio cache? This cannot be undone.")) return;
    setError(null);
    try {
      const result = await api.clearCache();
      setMessage(`Cleared ${result.deleted_entries} entries (${formatBytes(result.freed_bytes)} freed)`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear cache");
    }
  };

  const clearCatalogCache = async () => {
    if (!window.confirm("Delete all cached artist and album metadata? This cannot be undone.")) return;
    setError(null);
    try {
      const result = await api.clearCatalogCache();
      setMessage(
        `Cleared ${result.deleted_entries} catalog entr${result.deleted_entries === 1 ? "y" : "ies"} (${formatBytes(result.freed_bytes)} freed)`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear catalog cache");
    }
  };

  const clearCatalogOlderThan = async () => {
    const days = Number(purgeCatalogOlderDays);
    if (!days || days < 1) return;
    if (!window.confirm(`Delete catalog metadata cached more than ${days} days ago?`)) return;
    setError(null);
    try {
      const result = await api.clearCatalogCache({ olderThanDays: days });
      setMessage(
        `Removed ${result.deleted_entries} catalog entr${result.deleted_entries === 1 ? "y" : "ies"} (${formatBytes(result.freed_bytes)} freed)`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear old catalog cache");
    }
  };

  const runCatalogCleanup = async () => {
    setError(null);
    try {
      const result = await api.runCatalogCacheCleanup();
      setMessage(
        `Catalog cleanup removed ${result.deleted_entries} entr${result.deleted_entries === 1 ? "y" : "ies"} (${formatBytes(result.freed_bytes)} freed)`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Catalog cleanup failed");
    }
  };

  const clearByUser = async () => {
    if (!purgeUserId) return;
    const selected = users.find((u) => u.id === Number(purgeUserId));
    if (!window.confirm(`Clear cache entries only accessed by ${selected?.display_name ?? "this user"}?`)) return;
    setError(null);
    try {
      const result = await api.clearCache({ userId: Number(purgeUserId) });
      setMessage(`Removed ${result.deleted_entries} entries (${formatBytes(result.freed_bytes)} freed)`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear user cache");
    }
  };

  const clearOlderThan = async () => {
    const days = Number(purgeOlderDays);
    if (!days || days < 1) return;
    if (!window.confirm(`Delete cache entries not accessed in the last ${days} days?`)) return;
    setError(null);
    try {
      const result = await api.clearCache({ olderThanDays: days });
      setMessage(`Removed ${result.deleted_entries} entries (${formatBytes(result.freed_bytes)} freed)`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not clear old cache");
    }
  };

  const deleteEntry = async (videoId: string) => {
    if (!window.confirm(`Delete cached audio for ${videoId}?`)) return;
    setError(null);
    try {
      await api.clearCacheEntry(videoId);
      setMessage(`Removed ${videoId} from cache`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete entry");
    }
  };

  const visibleVideoIds = entries.map((entry) => entry.video_id);
  const allVisibleSelected =
    visibleVideoIds.length > 0 && visibleVideoIds.every((videoId) => selectedVideoIds.has(videoId));
  const someVisibleSelected = visibleVideoIds.some((videoId) => selectedVideoIds.has(videoId));

  const toggleSelected = (videoId: string) => {
    setSelectedVideoIds((current) => {
      const next = new Set(current);
      if (next.has(videoId)) next.delete(videoId);
      else next.add(videoId);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedVideoIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        for (const videoId of visibleVideoIds) next.delete(videoId);
      } else {
        for (const videoId of visibleVideoIds) next.add(videoId);
      }
      return next;
    });
  };

  const deleteSelected = async () => {
    const videoIds = [...selectedVideoIds];
    if (videoIds.length === 0) return;
    if (
      !window.confirm(
        `Delete ${videoIds.length} selected cached track${videoIds.length === 1 ? "" : "s"}? This cannot be undone.`,
      )
    ) {
      return;
    }
    setError(null);
    try {
      const result = await api.clearCacheEntries(videoIds);
      setMessage(
        `Removed ${result.deleted_entries} selected entr${result.deleted_entries === 1 ? "y" : "ies"} (${formatBytes(result.freed_bytes)} freed)`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete selected entries");
    }
  };

  return (
    <div className="page">
      <h1>Cache management</h1>
      <p className="muted">
        Server-side audio files are shared across users. Catalog metadata from MusicBrainz is cached in the
        database for faster artist and album pages.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="accent">{message}</p> : null}

      {stats ? (
        <>
          <div className="card">
            <p className="label">Audio files</p>
            <p className="track-title">
              {stats.entry_count} tracks · {formatBytes(stats.total_size_bytes)} · {stats.unique_users} users
            </p>
            <p className="muted">
              {stats.oldest_accessed_at
                ? `Last accessed from ${new Date(stats.oldest_accessed_at).toLocaleString()} to ${new Date(stats.newest_accessed_at ?? stats.oldest_accessed_at).toLocaleString()}`
                : "No cached tracks yet"}
            </p>
          </div>

          <div className="card">
            <p className="label">Catalog metadata</p>
            <p className="track-title">
              {stats.catalog.entry_count} entries · {formatBytes(stats.catalog.total_size_bytes)}
            </p>
            <p className="muted">
              {stats.catalog.artist_count} artists · {stats.catalog.album_count} albums ·{" "}
              {stats.catalog.track_resolve_count} track matches · {stats.catalog.api_response_count} API responses
            </p>
            <p className="muted">
              {stats.catalog.oldest_cached_at
                ? `Cached from ${new Date(stats.catalog.oldest_cached_at).toLocaleString()} to ${new Date(stats.catalog.newest_cached_at ?? stats.catalog.oldest_cached_at).toLocaleString()}${
                    settings?.catalog_cache_retention_days == null
                      ? " · kept until manually cleared"
                      : ` · auto-expires after ${settings.catalog_cache_retention_days} days`
                  }`
                : "No catalog metadata cached yet"}
            </p>
          </div>
        </>
      ) : null}

      {settings ? (
        <div className="card">
          <h2>Catalog metadata settings</h2>
          <input
            className="input"
            placeholder="Retention days (empty = permanent)"
            value={catalogRetentionDays}
            onChange={(e) => setCatalogRetentionDays(e.target.value)}
          />
          <input
            className="input"
            placeholder="Max cache size MB (empty = unlimited)"
            value={catalogMaxSizeMb}
            onChange={(e) => setCatalogMaxSizeMb(e.target.value)}
          />
          <button type="button" className="btn-primary btn-block" onClick={() => void saveSettings()}>
            Save settings
          </button>
          <button type="button" className="btn-secondary btn-block" onClick={() => void runCatalogCleanup()}>
            Run catalog retention cleanup now
          </button>
        </div>
      ) : null}

      <div className="card">
        <h2>Clear catalog metadata</h2>
        <button type="button" className="btn-secondary btn-block" onClick={() => void clearCatalogCache()}>
          Clear entire catalog cache
        </button>
        <input
          className="input"
          placeholder="Older than N days"
          value={purgeCatalogOlderDays}
          onChange={(e) => setPurgeCatalogOlderDays(e.target.value)}
        />
        <button type="button" className="btn-secondary btn-block" onClick={() => void clearCatalogOlderThan()}>
          Clear entries older than N days
        </button>
      </div>

      {settings ? (
        <div className="card">
          <h2>Audio cache settings</h2>
          <label className="muted">
            <input
              type="checkbox"
              checked={settings.cache_enabled}
              onChange={(e) => setSettings({ ...settings, cache_enabled: e.target.checked })}
            />{" "}
            Enable disk caching
          </label>
          <input
            className="input"
            placeholder="Retention days (empty = permanent)"
            value={retentionDays}
            onChange={(e) => setRetentionDays(e.target.value)}
          />
          <input
            className="input"
            placeholder="Re-check metadata after N days"
            value={refreshDays}
            onChange={(e) => setRefreshDays(e.target.value)}
          />
          <input
            className="input"
            placeholder="Max cache size MB (empty = unlimited)"
            value={maxSizeMb}
            onChange={(e) => setMaxSizeMb(e.target.value)}
          />
          <input
            className="input"
            placeholder="Cleanup interval (hours)"
            value={cleanupHours}
            onChange={(e) => setCleanupHours(e.target.value)}
          />
          <input
            className="input"
            placeholder="Deleted playlist retention (days, 0 = never purge)"
            value={playlistRetentionDays}
            onChange={(e) => setPlaylistRetentionDays(e.target.value)}
          />
          <button type="button" className="btn-primary btn-block" onClick={() => void saveSettings()}>
            Save settings
          </button>
          <button type="button" className="btn-secondary btn-block" onClick={() => void runCleanup()}>
            Run retention cleanup now
          </button>
        </div>
      ) : null}

      <div className="card">
        <h2>Clear audio cache</h2>
        <button type="button" className="btn-secondary btn-block" onClick={() => void clearAll()}>
          Clear entire cache
        </button>
        <select className="input" value={purgeUserId} onChange={(e) => setPurgeUserId(e.target.value)}>
          <option value="">Select user to clear…</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.display_name} (@{u.username})
            </option>
          ))}
        </select>
        <button type="button" className="btn-secondary btn-block" onClick={() => void clearByUser()}>
          Clear selected user&apos;s cache
        </button>
        <input
          className="input"
          placeholder="Older than N days"
          value={purgeOlderDays}
          onChange={(e) => setPurgeOlderDays(e.target.value)}
        />
        <button type="button" className="btn-secondary btn-block" onClick={() => void clearOlderThan()}>
          Clear entries older than N days
        </button>
      </div>

      <h2 className="section-label">Cached tracks</h2>
      <select className="input" value={filterUserId} onChange={(e) => setFilterUserId(e.target.value)}>
        <option value="">All users</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.display_name}
          </option>
        ))}
      </select>

      {entries.length > 0 ? (
        <div className="cache-bulk-toolbar">
          <label className="muted cache-select-all">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              ref={(input) => {
                if (input) input.indeterminate = someVisibleSelected && !allVisibleSelected;
              }}
              onChange={() => toggleSelectAllVisible()}
            />{" "}
            Select all shown
          </label>
          <button
            type="button"
            className="btn-secondary"
            disabled={selectedVideoIds.size === 0}
            onClick={() => void deleteSelected()}
          >
            Delete selected ({selectedVideoIds.size})
          </button>
        </div>
      ) : null}

      {entries.map((entry) => (
        <div key={entry.video_id} className="member-row cache-entry-row">
          <label className="cache-entry-select">
            <input
              type="checkbox"
              checked={selectedVideoIds.has(entry.video_id)}
              onChange={() => toggleSelected(entry.video_id)}
            />
          </label>
          <div className="cache-entry-body">
            <div className="track-title">{entry.title ?? "Unknown track"}</div>
            <div className="track-subtitle">
              {entry.artist ? `${entry.artist} · ` : ""}
              {entry.video_id} · {formatBytes(entry.file_size_bytes)} · cached{" "}
              {new Date(entry.cached_at).toLocaleString()}
              {entry.cached_by_username ? ` · first by ${entry.cached_by_username}` : ""}
            </div>
            <div className="muted">
              {entry.users.map((u) => u.display_name).join(", ") || "No access records"}
            </div>
          </div>
          <button type="button" className="btn-secondary" onClick={() => void deleteEntry(entry.video_id)}>
            Delete
          </button>
        </div>
      ))}

      <Link to="/settings" className="accent">
        Back to settings
      </Link>
    </div>
  );
}
