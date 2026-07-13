import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronRight,
  Compass,
  Home,
  Library,
  Radio,
  Search,
  Settings,
} from "lucide-react";
import { useGlobalPlayerHotkeys } from "@/hooks/useGlobalPlayerHotkeys";
import { cn } from "@/lib/cn";
import { hasActivePlayback, usePlayerStore } from "@/stores/playerStore";

const browseLinks = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/search", label: "Search", icon: Search },
] as const;

const libraryLinks = [
  { to: "/library", label: "Your Library", icon: Library },
  { to: "/player", label: "Now Playing", icon: Radio },
] as const;

function NavItem({
  to,
  label,
  icon: Icon,
  end,
  live,
}: {
  to: string;
  label: string;
  icon: typeof Home;
  end?: boolean;
  live?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors",
          isActive
            ? "bg-highlight text-text"
            : "text-text-secondary hover:bg-highlight/60 hover:text-text",
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-accent" />
          ) : null}
          <Icon
            className={cn("size-5 shrink-0", isActive ? "text-accent" : "text-text-secondary group-hover:text-text")}
            strokeWidth={isActive ? 2.25 : 2}
          />
          <span className="truncate">{label}</span>
          {live ? (
            <span className="tf-live-dot ml-auto size-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
          ) : null}
        </>
      )}
    </NavLink>
  );
}

export function Layout() {
  useGlobalPlayerHotkeys();
  const navigate = useNavigate();
  const playbackActive = usePlayerStore((s) => hasActivePlayback(s));

  return (
    <div
      className={cn(
        "grid min-h-screen grid-cols-1 bg-base md:grid-cols-[var(--spacing-sidebar)_1fr]",
        playbackActive ? "pb-[calc(var(--spacing-player)+3.5rem)] md:pb-[var(--spacing-player)]" : "pb-16 md:pb-0",
      )}
    >
      {/* Desktop sidebar */}
      <aside className="hidden flex-col gap-6 border-r border-border bg-surface p-5 md:flex">
        <div className="px-2">
          <div className="text-2xl font-extrabold tracking-tight text-accent">Tuneflow</div>
        </div>

        <nav className="flex flex-col gap-1" aria-label="Browse">
          {browseLinks.map((link) => (
            <NavItem key={link.to} {...link} />
          ))}
        </nav>

        <div>
          <p className="mb-2 px-3 text-[0.7rem] font-bold uppercase tracking-[0.12em] text-text-muted">
            Your Library
          </p>
          <nav className="flex flex-col gap-1" aria-label="Library">
            {libraryLinks.map((link) => (
              <NavItem
                key={link.to}
                {...link}
                live={link.to === "/player" ? playbackActive : undefined}
              />
            ))}
          </nav>
        </div>

        <div className="mt-auto">
          <NavItem to="/settings" label="Settings" icon={Settings} />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-[var(--spacing-topbar)] items-center gap-3 border-b border-border/40 bg-base/80 px-4 backdrop-blur-xl md:px-8">
          <div className="hidden items-center gap-2 md:flex">
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-full bg-elevated text-text-secondary transition hover:text-text"
              aria-label="Go back"
              onClick={() => navigate(-1)}
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              className="inline-flex size-8 items-center justify-center rounded-full bg-elevated text-text-secondary transition hover:text-text"
              aria-label="Go forward"
              onClick={() => navigate(1)}
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
          <div className="text-sm font-semibold text-text-secondary md:hidden">Tuneflow</div>
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        className={cn(
          "fixed inset-x-0 z-40 flex border-t border-border bg-surface/95 backdrop-blur-xl md:hidden",
          playbackActive ? "bottom-[var(--spacing-player)]" : "bottom-0",
        )}
        aria-label="Mobile navigation"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {[...browseLinks, libraryLinks[0], { to: "/settings", label: "Settings", icon: Settings }].map(
          (link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={"end" in link ? link.end : undefined}
              className={({ isActive }) =>
                cn(
                  "flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.65rem] font-semibold",
                  isActive ? "text-accent" : "text-text-muted",
                )
              }
            >
              <link.icon className="size-5" />
              <span>{link.label === "Your Library" ? "Library" : link.label}</span>
            </NavLink>
          ),
        )}
      </nav>
    </div>
  );
}
