import { useEffect, useMemo, useState } from "react";
import { EqProfilePickerModal } from "@/components/EqProfilePickerModal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  bandsEqual,
  cloneBands,
  createFlatBands,
  formatBandLabel,
} from "@/lib/eqBands";
import { applyEqPreview, getResolvedEqForCurrentTrack } from "@/lib/eqSync";
import { useEqStore } from "@/stores/eqStore";
import { usePlayerStore } from "@/stores/playerStore";
import type { EqBand } from "@/types";

type Props = {
  className?: string;
};

export function EqualizerPanel({ className }: Props) {
  const current = usePlayerStore((s) => s.current);
  const queueSource = usePlayerStore((s) => s.queueSource);
  const queueEqProfileId = usePlayerStore((s) => s.queueEqProfileId);
  const eqBroadcastActive = usePlayerStore((s) => s.eqBroadcastActive);
  const setQueueEqProfile = usePlayerStore((s) => s.setQueueEqProfile);
  const profiles = useEqStore((s) => s.profiles);
  const enabled = useEqStore((s) => s.enabled);
  const loaded = useEqStore((s) => s.loaded);
  const trackAssignments = useEqStore((s) => s.trackAssignments);
  const playlistAssignments = useEqStore((s) => s.playlistAssignments);
  const setEnabled = useEqStore((s) => s.setEnabled);
  const createProfile = useEqStore((s) => s.createProfile);
  const updateProfile = useEqStore((s) => s.updateProfile);
  const deleteProfile = useEqStore((s) => s.deleteProfile);
  const setDefaultProfile = useEqStore((s) => s.setDefaultProfile);
  const assignTrack = useEqStore((s) => s.assignTrack);
  const assignPlaylist = useEqStore((s) => s.assignPlaylist);
  const ensureTrackAssignment = useEqStore((s) => s.ensureTrackAssignment);
  const ensurePlaylistAssignment = useEqStore((s) => s.ensurePlaylistAssignment);

  const [selectedProfileId, setSelectedProfileId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("Custom");
  const [bands, setBands] = useState<EqBand[]>(createFlatBands);
  const [preampDb, setPreampDb] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [trackPickerOpen, setTrackPickerOpen] = useState(false);
  const [playlistPickerOpen, setPlaylistPickerOpen] = useState(false);
  const [queuePickerOpen, setQueuePickerOpen] = useState(false);

  const resolved = useMemo(() => getResolvedEqForCurrentTrack(), [
    current?.video_id,
    queueSource,
    queueEqProfileId,
    eqBroadcastActive,
    profiles,
    trackAssignments,
    playlistAssignments,
  ]);

  useEffect(() => {
    if (!loaded) {
      void useEqStore.getState().load();
    }
  }, [loaded]);

  useEffect(() => {
    if (!current) return;
    void ensureTrackAssignment(current.video_id);
    if (queueSource?.type === "playlist") {
      void ensurePlaylistAssignment(queueSource.id);
    }
  }, [current?.video_id, ensurePlaylistAssignment, ensureTrackAssignment, queueSource]);

  useEffect(() => {
    if (profiles.length === 0) return;
    const activeProfileId =
      resolved?.profileId ??
      profiles.find((profile) => profile.is_default)?.id ??
      profiles[0]?.id ??
      null;
    if (selectedProfileId == null && activeProfileId != null) {
      const profile = profiles.find((item) => item.id === activeProfileId);
      if (profile) {
        setSelectedProfileId(profile.id);
        setDraftName(profile.name);
        setBands(cloneBands(profile.bands));
        setPreampDb(profile.preamp_db);
      }
    }
  }, [profiles, resolved?.profileId, selectedProfileId]);

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const dirty =
    selectedProfile != null &&
    (!bandsEqual(bands, selectedProfile.bands) || preampDb !== selectedProfile.preamp_db);

  const showStatus = (message: string) => {
    setStatus(message);
    window.setTimeout(() => setStatus(null), 2200);
  };

  const loadProfileIntoEditor = (profileId: number) => {
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return;
    setSelectedProfileId(profile.id);
    setDraftName(profile.name);
    setBands(cloneBands(profile.bands));
    setPreampDb(profile.preamp_db);
  };

  const handleSave = async () => {
    if (!selectedProfile || busy) return;
    setBusy(true);
    try {
      const updated = await updateProfile(selectedProfile.id, {
        name: draftName.trim() || selectedProfile.name,
        bands,
        preamp_db: preampDb,
      });
      setDraftName(updated.name);
      showStatus("Profile saved");
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setBusy(false);
    }
  };

  const handleSaveAsNew = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const created = await createProfile(draftName.trim() || `Profile ${profiles.length + 1}`, bands, preampDb);
      loadProfileIntoEditor(created.id);
      showStatus("Profile created");
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "Could not create profile");
    } finally {
      setBusy(false);
    }
  };

  const handleApplyLive = (nextBands: EqBand[], nextPreampDb: number) => {
    void applyEqPreview(nextBands, nextPreampDb);
  };

  const handleDelete = async () => {
    if (!selectedProfile || busy || profiles.length <= 1) return;
    setBusy(true);
    try {
      await deleteProfile(selectedProfile.id);
      const next = useEqStore.getState().profiles[0];
      if (next) loadProfileIntoEditor(next.id);
      else {
        setSelectedProfileId(null);
        setBands(createFlatBands());
        setPreampDb(0);
      }
      showStatus("Profile deleted");
    } catch (err) {
      showStatus(err instanceof Error ? err.message : "Could not delete profile");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="equalizer" className={className}>
      <div className="rounded-2xl border border-border/80 bg-elevated/80 p-5 shadow-card backdrop-blur-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-lg font-bold">Equalizer</h2>
            <p className="mt-1 mb-0 text-sm text-text-secondary">
              {resolved
                ? `Active: ${resolved.profileName ?? resolved.source}${eqBroadcastActive ? " · broadcast on" : ""}`
                : "Adjust frequency bands and save profiles"}
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enabled
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-[180px] flex-1 text-sm text-text-secondary">
            Profile
            <select
              className="mt-1 w-full rounded-lg border border-border bg-base px-3 py-2 text-sm text-text"
              value={selectedProfileId ?? ""}
              onChange={(event) => loadProfileIntoEditor(Number(event.target.value))}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                  {profile.is_default ? " (default)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-[180px] flex-1 text-sm text-text-secondary">
            Name
            <Input className="mt-1" value={draftName} onChange={(event) => setDraftName(event.target.value)} />
          </label>
        </div>

        <div className="mt-5 flex items-end justify-between gap-3 overflow-x-auto pb-1">
          {bands.map((band, index) => (
            <label key={band.freq} className="flex min-w-[42px] flex-col items-center gap-2 text-xs text-text-muted">
              <input
                type="range"
                min={-12}
                max={12}
                step={0.5}
                value={band.gainDb}
                className="h-28 w-8 [appearance:slider-vertical] [writing-mode:vertical-lr]"
                style={{ writingMode: "vertical-lr" }}
                onChange={(event) => {
                  const gainDb = Number(event.target.value);
                  const nextBands = bands.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, gainDb } : item,
                  );
                  setBands(nextBands);
                  handleApplyLive(nextBands, preampDb);
                }}
              />
              <span>{formatBandLabel(band.freq)}</span>
            </label>
          ))}
        </div>

        <label className="mt-4 block text-sm text-text-secondary">
          Preamp ({preampDb.toFixed(1)} dB)
          <input
            type="range"
            min={-12}
            max={12}
            step={0.5}
            value={preampDb}
            className="mt-2 w-full"
            onChange={(event) => {
              const nextPreamp = Number(event.target.value);
              setPreampDb(nextPreamp);
              handleApplyLive(bands, nextPreamp);
            }}
          />
        </label>

        <div className="mt-5 flex flex-wrap gap-2">
          <Button size="sm" disabled={!selectedProfile || !dirty || busy} onClick={() => void handleSave()}>
            Save
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleSaveAsNew()}>
            Save as new
          </Button>
          {selectedProfile ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || selectedProfile.is_default}
              onClick={() => void setDefaultProfile(selectedProfile.id).then(() => showStatus("Default updated"))}
            >
              Set default
            </Button>
          ) : null}
          {selectedProfile && profiles.length > 1 ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void handleDelete()}>
              Delete
            </Button>
          ) : null}
        </div>

        {current ? (
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            <Button size="sm" variant="secondary" onClick={() => setTrackPickerOpen(true)}>
              Assign to this track
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={trackAssignments[current.video_id] == null}
              onClick={() => void assignTrack(current.video_id, null).then(() => showStatus("Track EQ cleared"))}
            >
              Clear track EQ
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setQueuePickerOpen(true)}>
              Set queue EQ
            </Button>
            {queueSource?.type === "playlist" ? (
              <Button size="sm" variant="secondary" onClick={() => setPlaylistPickerOpen(true)}>
                Assign to playlist
              </Button>
            ) : null}
          </div>
        ) : null}

        {status ? (
          <p className="mt-3 text-sm text-accent" role="status" aria-live="polite">
            {status}
          </p>
        ) : null}
      </div>

      <EqProfilePickerModal
        visible={trackPickerOpen}
        title="Assign EQ to track"
        profiles={profiles}
        selectedProfileId={current ? trackAssignments[current.video_id] : null}
        onClose={() => setTrackPickerOpen(false)}
        onSelect={async (profileId) => {
          if (!current || profileId == null) return;
          await assignTrack(current.video_id, profileId);
          showStatus("Track EQ assigned");
        }}
      />
      <EqProfilePickerModal
        visible={queuePickerOpen}
        title="Set queue EQ"
        profiles={profiles}
        selectedProfileId={queueEqProfileId}
        clearLabel="Clear queue EQ"
        onClose={() => setQueuePickerOpen(false)}
        onSelect={async (profileId) => {
          setQueueEqProfile(profileId);
          showStatus(profileId == null ? "Queue EQ cleared" : "Queue EQ set");
        }}
      />
      {queueSource?.type === "playlist" ? (
        <EqProfilePickerModal
          visible={playlistPickerOpen}
          title="Assign EQ to playlist"
          profiles={profiles}
          selectedProfileId={playlistAssignments[queueSource.id] ?? null}
          onClose={() => setPlaylistPickerOpen(false)}
          onSelect={async (profileId) => {
            await assignPlaylist(queueSource.id, profileId);
            showStatus(profileId == null ? "Playlist EQ cleared" : "Playlist EQ assigned");
          }}
        />
      ) : null}
    </section>
  );
}
