# PDX Mod Hub

One dashboard for every Steam Workshop mod across your Paradox Interactive games.

PDX Mod Hub is a local web app for Windows. A small Node.js server scans your Steam libraries, tracks Workshop updates through the public Steam Web API, scrapes change notes, and serves a single-page UI in your browser tab. Subscribing and downloading are delegated entirely to the Steam client itself through bounded Steamworks helper sessions — no credentials, no duplicate downloads, no files written outside Steam's own workshop folders.

## What it does

- **Updates feed (home)** — a mission log of recently updated mods with hero art and their change notes inline. The key distinction the whole app is built around: **Awaiting Steam** (the mod updated on the Workshop but your Steam client has not fetched it yet — hot amber) vs **Queued for launch** (Steam noticed, will download at next game launch) vs **Fetched** (done, with a brief celebration animation when it lands).
- **Library** — every subscribed and installed mod across all your Paradox games in one sortable, filterable table: state, size on disk, subscribers, Workshop-update vs local-copy timestamps, game-version targets (Vic3/EU5 branch ranges), bulk actions, open folder / open in Steam.
- **Browse** — search any game's Workshop right in the app (trending / newest / most subscribed / text search), with star ratings, tags, and one-click Subscribe. Downloads happen through the Steam client.
- **Force download** — when Steam is being slow to pick up an update, kick it: subscribe/download through a helper, with the RimSort-proven unsub-resub-download fallback for stubborn cases.
- **Sync** — pull your account-level subscription list per game (catches subscribed-but-never-installed and installed-but-unsubscribed drift that local files cannot see).
- **Three-state theme** (auto / dark / light, follows the OS by default) and a bilingual UI (English / 简体中文), with a command palette (Ctrl+K), SSE live updates, and no Electron — it is just a browser tab.

## How it works

| Concern | Mechanism |
| --- | --- |
| Which games / mods you have | Local Steam files: `libraryfolders.vdf`, `appmanifest_*.acf`, `appworkshop_<appid>.acf` (read-only) |
| Update detection | Keyless batch `ISteamRemoteStorage/GetPublishedFileDetails` polls (default every 5 min), diffed against the last seen `time_updated` — not against Steam's own `NeedsUpdate` flag, which is demonstrably stale |
| Change notes | `steamcommunity.com/sharedfiles/filedetails/changelog/<id>` scraping through one global throttled queue (4 s spacing, 429 backoff, circuit breaker), sanitized before caching |
| Download completion | `fs.watch` on the workshop directories (Steam replaces ACFs by rename, so the files themselves cannot be watched) plus a 60 s stat backstop — mod state only flips when Steam's own files change |
| Subscribe / unsubscribe / force download / browse / sync | A `steamworks.js` helper child process, one appid at a time — every op (actions, browse, sync) runs through a single persistent session per appid. Note: while a helper runs, Steam shows you as "In-Game" for that title — sessions close after 60 s idle (10 min hard cap), so a burst of actions or Browse paging costs one flash, not one per click |
| Mod art | `/api/img` proxy with SSRF hardening (host allowlist, DNS pinning, magic-byte sniffing) and a 500 MB LRU disk cache |

The server binds to `127.0.0.1` only and defends the localhost surface: Host/Origin allowlists, a custom `X-PMH` header on API routes, CSP, sanitized BBCode/changelog HTML, prototype-pollution-safe settings.

## Requirements

- Windows 10/11 with the Steam client installed and logged in
- Node.js 22+
- Paradox games with Steam Workshop support (CK3, EU4, EU5, HOI4, Stellaris, Victoria 3, Imperator, AoW4, and more are recognized automatically; games on Paradox Mods — e.g. Cities: Skylines II — are listed but not browsable)

## Run

```powershell
npm install
npm run build     # build the SPA once
npm run start     # server on http://127.0.0.1:8768
```

Open http://127.0.0.1:8768 in your browser. For development, `npm run dev` runs the server plus a Vite dev server on :5173 with hot reload.

To start hidden at login, put a shortcut to `scripts/run_hub_hidden.vbs` in `shell:startup`.

## Configuration

Settings live in the UI (Settings page) and persist to `data/settings.json`:

| Setting | Default | Notes |
| --- | --- | --- |
| `pollIntervalSec` | 300 | Steam Web API poll cadence, clamped 60–3600 |
| `language` | `en` | `en` or `zh` |
| `changelogPrefetch` | `true` | Fetch change notes automatically when an update is detected |
| `port` | 8768 | Not exposed in the UI — edit `data/settings.json` directly; requires restart |
| `steamRootOverride` | *(unset)* | Override the auto-detected Steam install root |
| `steamWebApiKey` | *(unset)* | Optional [Steam Web API key](https://steamcommunity.com/dev/apikey); switches author-name resolution to batched `GetPlayerSummaries` |

Theme (auto/dark/light) is client-side (`localStorage`), not a server setting. All caches and state live under `data/` (gitignored).

## Repository layout

```
server/   Express + TypeScript backend (scan, poll, changelog, actions, SSE)
helper/   steamworks.js helper (one-shot commands + stdin/stdout sessions)
web/      Vite + React + Tailwind v4 + framer-motion SPA
docs/     Design spec, API contract amendments, build checklist
scripts/  Hidden-start VBS and dev utilities
```

## Known limitations (v1)

- Author names resolve asynchronously: Steam returns a raw SteamID64, and the app resolves persona names/avatars in the background (keyless profile lookup, or batched GetPlayerSummaries when a Steam Web API key is configured). Freshly browsed rows may show no author for a few seconds until the cache fills.
- Mod dependencies ("required items") surface in Browse when Steam provides them; the Detail sheet's dependency lists and the reverse-dependency index are placeholders.
- Games whose modding lives on Paradox Mods (Cities: Skylines II, Millennia, Empire of Sin, BATTLETECH) are listed but not browsable.
- Changelog scraping depends on steamcommunity.com page markup; the parser is tolerant and fails soft, but a Steam redesign may require a small update.
- Local (non-Workshop) mods in `Documents/Paradox Interactive` are not scanned yet.

## License

MIT
