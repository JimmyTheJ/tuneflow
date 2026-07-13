import { NavLink, Outlet } from "react-router-dom";
import { useGlobalPlayerHotkeys } from "@/hooks/useGlobalPlayerHotkeys";
import { hasActivePlayback, usePlayerStore } from "@/stores/playerStore";

const links = [
  { to: "/", label: "Home", end: true },
  { to: "/discover", label: "Discover" },
  { to: "/search", label: "Search" },
  { to: "/library", label: "Library" },
  { to: "/player", label: "Now Playing" },
  { to: "/settings", label: "Settings" },
];

export function Layout() {
  useGlobalPlayerHotkeys();
  const playbackActive = usePlayerStore((s) => hasActivePlayback(s));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Tuneflow</div>
        <nav>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={({ isActive }) => {
                const classes = ["nav-link"];
                if (isActive) classes.push("active");
                if (link.to === "/player" && playbackActive) classes.push("nav-link-live");
                return classes.join(" ");
              }}
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
