import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { MiniPlayer } from "@/components/MiniPlayer";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/authStore";
import { usePlayerStore } from "@/stores/playerStore";
import { LoginPage, SetupPage } from "@/pages/AuthPages";
import { DiscoverPage } from "@/pages/DiscoverPage";
import { FamilyPage } from "@/pages/FamilyPage";
import { HomePage } from "@/pages/HomePage";
import { LibraryPage } from "@/pages/LibraryPage";
import { ParentalPage } from "@/pages/ParentalPage";
import { PlayerPage } from "@/pages/PlayerPage";
import { PlaylistPage } from "@/pages/PlaylistPage";
import { SearchPage } from "@/pages/SearchPage";
import { AdminCachePage } from "@/pages/AdminCachePage";
import { AdminIntegrationsPage } from "@/pages/AdminIntegrationsPage";
import { DeletedUsersPage } from "@/pages/DeletedUsersPage";
import { SettingsPage } from "@/pages/SettingsPage";

function Protected({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const isReady = useAuthStore((s) => s.isReady);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    void api.setupStatus().then((s) => setNeedsSetup(s.needs_setup));
  }, []);

  if (!isReady || needsSetup === null) {
    return <div className="loading-screen">Loading…</div>;
  }
  if (needsSetup) return <Navigate to="/setup" replace />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  const hydrate = useAuthStore((s) => s.hydrate);
  const isReady = useAuthStore((s) => s.isReady);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    usePlayerStore.getState().recoverSession();
  }, []);

  if (!isReady) return <div className="loading-screen">Loading…</div>;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/setup" element={<SetupPage />} />
        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route index element={<HomePage />} />
          <Route path="discover" element={<DiscoverPage />} />
          <Route path="search" element={<SearchPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin/cache" element={<AdminCachePage />} />
          <Route path="admin/integrations" element={<AdminIntegrationsPage />} />
          <Route path="admin/users/deleted" element={<DeletedUsersPage />} />
          <Route path="family" element={<FamilyPage />} />
          <Route path="parental" element={<ParentalPage />} />
          <Route path="playlist/:id" element={<PlaylistPage />} />
          <Route path="player" element={<PlayerPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <MiniPlayer />
    </BrowserRouter>
  );
}
