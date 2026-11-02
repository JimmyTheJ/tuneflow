import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export function JellyfinSettings() {
  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.jellyfinStatus>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = async () => {
    const next = await api.jellyfinStatus();
    setStatus(next);
    setServer((current) => current || next.connection?.server_url || next.default_server_url || "");
  };
  useEffect(() => { void refresh().catch(() => undefined); }, []);
  const run = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true); setMessage("");
    try { await work(); setPassword(""); await refresh(); setMessage(message); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Request failed"); }
    finally { setBusy(false); }
  };
  return <Card className="space-y-3">
    <h2 className="m-0 text-lg font-bold">Jellyfin music library</h2>
    <p className="text-sm text-text-secondary">Jellyfin manages your files. Tuneflow plays your music.</p>
    {status?.linked ? <p>{status.connection?.display_name} · {status.track_count} tracks · Last sync: {status.connection?.synced_at ?? "Never"}</p> : null}
    {status?.connection?.sync_error ? <p role="alert">{status.connection.sync_error}</p> : null}
    <Input aria-label="Jellyfin server URL" placeholder="Jellyfin server URL" value={server} onChange={(e) => setServer(e.target.value)} />
    <Input aria-label="Jellyfin username" placeholder="Jellyfin username" autoComplete="off" value={username} onChange={(e) => setUsername(e.target.value)} />
    <Input aria-label="Jellyfin password" placeholder="Jellyfin password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || !server || !username} onClick={() => void run(async () => { await api.linkJellyfin(server, username, password); await api.syncJellyfin(); }, "Linked. Library sync queued; refresh the connection status shortly.")}>Link and sync</Button>
      {status?.linked ? <Button variant="secondary" disabled={busy} onClick={() => void run(api.syncJellyfin, "Library sync queued.")}>Sync library</Button> : null}
      <Button variant="secondary" disabled={busy} onClick={() => void run(refresh, "Connection status updated.")}>Refresh status</Button>
      {status?.linked ? <Button variant="secondary" disabled={busy} onClick={() => {
        if (window.confirm("Unlink Jellyfin and remove its Tuneflow index?")) void run(api.unlinkJellyfin, "Jellyfin unlinked.");
      }}>Unlink</Button> : null}
    </div>
    {message ? <p role="status" className="text-sm text-text-secondary">{message}</p> : null}
  </Card>;
}
