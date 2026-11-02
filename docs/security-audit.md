# Security review for the Rust rewrite

Reviewed: 2026-11-01. Scope: Rust API, React web client, native Android client,
deployment configuration, and their checked-in dependency lockfiles.

## Findings addressed

- Browser playback and downloads use one-track, short-lived media tickets. Full
  account JWTs are rejected in URL query parameters. Jellyfin artwork tiles use
  an Authorization header. Nginx and Rust request logs omit query strings, and
  responses carry a no-referrer policy.
- New and stored Jellyfin connections can reach only server-configured addresses
  (`JELLYFIN_URL` or `JELLYFIN_ALLOWED_URLS`). HTTP redirects are disabled in the
  Rust client's outbound requests. Unlinking a disallowed stored address still
  removes its local connection without sending a logout request.
- CORS is off by default; a separate browser origin must be listed explicitly.
  The web server also sets script, object, base URI, and framing restrictions.
- Android release builds require HTTPS for the API. Debug builds permit local
  HTTP development. Android session tokens are encrypted with Android Keystore.
- SQLx's unused MySQL/PostgreSQL default features were removed. This eliminated
  the transitive `rsa` crate with RUSTSEC-2023-0071 from the lockfile.
- The web lockfile was updated to versions without reported npm advisories.

## Verification

- `cargo test --locked --offline`: passed, including media token, isolation,
  migration, and Jellyfin allowlist tests.
- `cargo clippy --all-targets --locked --offline -- -D warnings`: passed.
- `cargo-audit audit --no-fetch --file services/server/Cargo.lock`: no reported
  vulnerabilities using a freshly fetched RustSec database. The crates.io index
  was unavailable, so the yanked-version check was incomplete.
- `npm audit --audit-level=moderate`: 0 reported vulnerabilities.
- `npm --prefix apps/web run build`: passed.
- Android `testDebugUnitTest lintDebug lintRelease`: passed; lint still reports
  warnings, including an exported MediaSessionService. Its callback accepts only
  this app or trusted media controllers.
- `docker compose --env-file .env.example config --quiet`: passed.
- A SQLite database generated from the legacy SQLAlchemy models was migrated by
  the Rust server; SQLite integrity and foreign-key checks passed.

## Remaining release checks

- Docker daemon access was unavailable during review. Build the images, run a
  container/image vulnerability scan, validate Nginx with `nginx -t` inside the
  built image, and smoke test login, Jellyfin link/sync, and media playback in
  the deployed stack before treating this as a production sign-off.
- The web client keeps its account JWT in localStorage. The script policy lowers
  script-injection risk, but a same-origin script compromise could still read it.
  Moving to a server-managed, HttpOnly cookie session would require a separate
  auth migration and CSRF design.
- Media tickets remain in URLs for browser audio/video tags. They are limited to
  one track and expire after one hour, but reverse proxies and external access
  logs must also avoid recording query strings.
- Container base image tags and yt-dlp's minimum-version install are not pinned
  to immutable digests or exact versions. Review and pin the tested production
  images and extractor version as part of the image build and scan.

The checks above are a code and dependency review, not an independent penetration
test or a certification against a named security standard.
