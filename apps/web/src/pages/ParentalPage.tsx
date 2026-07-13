import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { HourPicker } from "@/components/HourPicker";
import { TrackRow } from "@/components/TrackRow";
import { canManageParentalControls } from "@/lib/permissions";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import type { ChildProfile, ChildUsageToday, PlayHistoryEntry } from "@/types";

type Tab = "controls" | "history";

export function ParentalPage() {
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<Tab>("controls");
  const [children, setChildren] = useState<ChildProfile[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [usage, setUsage] = useState<ChildUsageToday | null>(null);
  const [history, setHistory] = useState<PlayHistoryEntry[]>([]);
  const [keywords, setKeywords] = useState("");
  const [videoIds, setVideoIds] = useState("");
  const [maxMinutes, setMaxMinutes] = useState("");
  const [startHour, setStartHour] = useState(8);
  const [endHour, setEndHour] = useState(20);
  const [blockExplicit, setBlockExplicit] = useState(true);
  const [searchEnabled, setSearchEnabled] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const profiles = await api.listChildren();
    setChildren(profiles);
    if (!selectedId && profiles[0]) setSelectedId(profiles[0].user.id);
  }, [selectedId]);

  const selected = children.find((c) => c.user.id === selectedId) ?? null;

  useEffect(() => {
    void load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [load]);

  useEffect(() => {
    if (!selected) return;
    const s = selected.settings;
    setKeywords(s.blocked_keywords.join(", "));
    setVideoIds(s.blocked_video_ids.join(", "));
    setMaxMinutes(s.max_daily_minutes != null ? String(s.max_daily_minutes) : "");
    setStartHour(s.allowed_start_hour);
    setEndHour(s.allowed_end_hour);
    setBlockExplicit(s.block_explicit);
    setSearchEnabled(s.search_enabled);
    void Promise.all([api.getChildUsage(selected.user.id), api.getChildHistory(selected.user.id)]).then(
      ([u, h]) => {
        setUsage(u);
        setHistory(h);
      },
    );
  }, [selected]);

  const save = async () => {
    if (!selected) return;
    await api.updateChildSettings(selected.user.id, {
      block_explicit: blockExplicit,
      search_enabled: searchEnabled,
      max_daily_minutes: maxMinutes.trim() ? Number(maxMinutes) : null,
      allowed_start_hour: startHour,
      allowed_end_hour: endHour,
      blocked_keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
      blocked_video_ids: videoIds.split(",").map((k) => k.trim()).filter(Boolean),
    });
    setMessage("Saved");
    await load();
  };

  if (!canManageParentalControls(user)) return <Navigate to="/settings" replace />;

  return (
    <div className="page">
      <h1>Parental controls</h1>
      <div className="tab-row">
        <button type="button" className={tab === "controls" ? "tab active" : "tab"} onClick={() => setTab("controls")}>
          Controls
        </button>
        <button type="button" className={tab === "history" ? "tab active" : "tab"} onClick={() => setTab("history")}>
          History
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="accent">{message}</p> : null}

      {children.length === 0 ? (
        <p className="muted">No child accounts. Add one from Family members.</p>
      ) : (
        <>
          <div className="chip-row">
            {children.map((c) => (
              <button
                key={c.user.id}
                type="button"
                className={selectedId === c.user.id ? "chip active" : "chip"}
                onClick={() => setSelectedId(c.user.id)}
              >
                {c.user.display_name}
              </button>
            ))}
          </div>

          {usage ? (
            <div className="card">
              <p>
                Today: {usage.listened_minutes_today} min listened
                {usage.max_daily_minutes != null ? ` · ${usage.remaining_minutes ?? 0} min left` : ""}
              </p>
            </div>
          ) : null}

          {tab === "controls" && selected ? (
            <div className="card">
              <label className="toggle-row">
                <span>Block explicit content</span>
                <input type="checkbox" checked={blockExplicit} onChange={(e) => setBlockExplicit(e.target.checked)} />
              </label>
              <label className="toggle-row">
                <span>Allow search</span>
                <input type="checkbox" checked={searchEnabled} onChange={(e) => setSearchEnabled(e.target.checked)} />
              </label>
              <input
                className="input"
                placeholder="Daily limit (minutes, blank = unlimited)"
                value={maxMinutes}
                onChange={(e) => setMaxMinutes(e.target.value)}
              />
              <HourPicker label="Earliest" value={startHour} onChange={setStartHour} />
              <HourPicker label="Latest (exclusive)" value={endHour} onChange={setEndHour} />
              <textarea
                className="input textarea"
                placeholder="Blocked keywords (comma-separated)"
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
              />
              <textarea
                className="input textarea"
                placeholder="Blocked video IDs (comma-separated)"
                value={videoIds}
                onChange={(e) => setVideoIds(e.target.value)}
              />
              <button type="button" className="btn-primary" onClick={() => void save()}>
                Save controls
              </button>
            </div>
          ) : null}

          {tab === "history" ? history.map((item) => <TrackRow key={item.id} track={item} />) : null}
        </>
      )}
    </div>
  );
}
