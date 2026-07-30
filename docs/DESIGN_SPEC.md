# PDX Mod Hub — Design Spec (Ground Station)

PDX MOD HUB — FINAL DESIGN SPEC ("GROUND STATION", unanimous winner, with all judge grafts folded in and disagreements resolved)

Identity: a command-deck ops console for Workshop telemetry. Mods are assets on orbit; Steam is the (slow) downlink; the home feed is the mission log; "updated but Steam hasn't fetched" is a signal acquired but not yet downlinked. All-IBM-Plex Apollo voice on cool graphite. Zero purple, zero gradient buttons, zero glassmorphism, zero emoji, one icon library (Lucide only: 16px inline / 18px nav, stroke 1.75, colored by text tier, accent only when active).

=== 1. THEME SYSTEM (three-state, owner requirement) ===
- States: auto (default, follows OS via prefers-color-scheme) / dark / light. Preference stored in localStorage key `pmh.theme` ('auto'|'dark'|'light'). Theme is CLIENT-ONLY — it is NOT in /api/settings.
- Mechanics: every color in the app is a CSS custom property; Tailwind v4 @theme maps utilities to var(--token). An inline <script> in <head> (before first paint, no flash) reads localStorage, resolves 'auto' via matchMedia('(prefers-color-scheme: dark)'), and sets data-theme="dark"|"light" on <html>; when preference is 'auto' it subscribes to the media-query change event and re-sets the attribute live. Also sets CSS `color-scheme: dark`/`light` on :root per theme so scrollbars/native inputs match.
- Control: compact 3-segment control (28px tall, 3 × 28px segments) in the ops-bar right cluster: ◐ auto / ● dark / ○ light (exact glyphs; tooltips "Auto / 跟随系统", "Dark / 深色", "Light / 浅色"). Active segment = accent-tinted pill sliding between segments via framer-motion layoutId + SNAP spring. Duplicated as a labeled row in Settings.
- Switch animation: document.startViewTransition crossfade ~200ms when available; instant fallback; instant under prefers-reduced-motion.

=== 2. COLOR TOKENS — COMPLETE DUAL PALETTE (token-for-token) ===
Format: --token: DARK / LIGHT.

Surfaces:
- --bg-0 (page): #0A0C0E / #ECEEF0 (cool graphite paper — same cool hue family, deliberately not zinc-blue in either theme)
- --bg-1 (card/surface): #111518 / #F6F7F8
- --bg-2 (raised/hover): #171C20 / #FCFDFD
- --bg-3 (overlay/popover/toast): #1D2328 / #FFFFFF
- --inset (inputs/wells): #07090D / #E4E7E9

Lines & structure:
- --line-1 (card/panel borders): rgba(255,255,255,0.07) / rgba(20,28,34,0.10)
- --line-div (row dividers): rgba(255,255,255,0.055) / rgba(20,28,34,0.07)
- --line-2 (hover borders, inputs, kbd): rgba(255,255,255,0.13) / rgba(20,28,34,0.18)
- --grid (blueprint grid on bg-0 only, 120px cells, 1px): rgba(151,173,183,0.045) / rgba(38,52,60,0.05)
- --edge-highlight (machined top edge on panels): inset 0 1px 0 rgba(255,255,255,0.04) / none (light drops it)

Text (3 tiers only; --text-3 restricted to labels ≤11px, never body — AA audited):
- --text-1: #E9EEF2 / #171C20
- --text-2: rgba(233,238,242,0.64) / rgba(23,28,32,0.66) (both ≥4.5:1 on their --bg-1)
- --text-3: rgba(233,238,242,0.40) / rgba(23,28,32,0.45)

Accent (SIGNAL AMBER — brand = the pending state, in both themes; split into text vs fill roles so light keeps contrast AND identity):
- --accent-text (links, icons, stamp text, active nav): #FFB454 / #9A6700 (4.6:1 on light --bg-1)
- --accent-graphic (spines, brackets, dots, ≥3px strokes): #FFB454 / #A06B00
- --accent-fill (primary buttons): #FFB454 / #E9992C; light-mode primary buttons additionally get 1px border #C07E17 so the fill holds an edge on white
- --accent-fill-hover: #FFC578 / #F2A63E; --accent-fill-pressed: #E69B3C / #D68A20
- --on-accent (text on amber fill): #161006 / #201603
- --accent-tint (selected row/active pill bg): rgba(255,180,84,0.10) / rgba(154,103,0,0.08)
- --focus-ring: 1px solid var(--accent-text) + 0 0 0 3px rgba(255,180,84,0.22) / rgba(154,103,0,0.18)

Mod states (semantic; light variants darkened for contrast, hue identity preserved):
- --state-pending (update-unseen-by-steam, THE hot reminder state): #FFB454 / #A06B00; tint rgba(255,180,84,0.10) / rgba(160,107,0,0.10)
- --state-pending-dim (update-pending-launch, calm variant): amber at 45% alpha over surface in both themes (rgba(255,180,84,0.45) / rgba(160,107,0,0.45))
- --state-fetched: #55C186 / #1E7A4C
- --state-downloading: #5CB3CF / #17789B
- --state-uptodate: rgba(233,238,242,0.28) / rgba(23,28,32,0.30)
- --state-orphaned: #8B9BB0 / #5B6B7C
- --state-error (banned/removed/failed): #E0564F / #C0392F
- not-installed = hollow 6px ring in --line-2 (both themes)

Per-game heraldic hues (bordered pills + rail glyphs + group headers ONLY):
- HOI4 #8C9BAA / #5A6B7A · Stellaris #4FA8C2 / #2E7D96 · Vic3 #C79A55 / #8A6420 · CK3 #C25B54 / #A03F38 · EU4 #4F9E7A / #2F6B4E · EU5 #7C8F5A / #556B37 · AoW4 #9B7FC2 / #6E4FA0 · Millennia #A88F6E / #7A6242

Elevation & shadows (the key dark/light difference):
- DARK: no shadows on in-flow surfaces ever — elevation = bg lightness step + hairline + --edge-highlight. Floating layers only (dropdown/palette/dialog/toast): 0 12px 32px rgba(0,0,0,0.55).
- LIGHT: soft shadows carry elevation where dark uses hairlines — card resting: 0 1px 2px rgba(20,28,34,0.05) + 1px --line-1; card hover: 0 2px 8px rgba(20,28,34,0.08); floating layers: 0 12px 32px rgba(20,28,34,0.16). Hairlines remain on everything; shadows are additive, never replace borders.

Atmosphere:
- Grain: 2.5% opacity monochrome SVG feTurbulence tile on --bg-0, pointer-events:none; light theme renders the same grain with mix-blend-mode:multiply at 3%.
- Dominant-color wash (detail view hero, cached per mod via fast-average-color on the proxied image): clamp DARK to S≤35% L 18–25%; clamp LIGHT to S≤30% L 88–93% (pastel wash); radial fade to --bg-0 within 400px.

Steam art on light backgrounds (owner requirement — inconsistent art must not blow out):
- Every image slot keeps a DARK base behind the art in BOTH themes: container background #111518, and the bottom scrim is always dark — linear-gradient(to top, rgba(10,12,14,0.94) 0, rgba(10,12,14,0.55) 45%, rgba(10,12,14,0.08) 78%, transparent). Text over art is therefore always light-on-dark in both themes ("art is a window into the night side") — hero cards look identical and never blow out.
- Light mode adds a mandatory 1px border rgba(20,28,34,0.14) around every image container so bright/white art doesn't fuse with the light page; rest-state filter relaxes to saturate(0.92) brightness(0.99) in light (dark keeps saturate(0.85) contrast(1.02) brightness(0.9)); both wake to full on hover, 220ms.
- Fallback tile (missing/broken art, deterministic): --bg-2 + game glyph + mod initials in Plex Condensed caps --text-3 — never a broken-image box.

=== 3. TYPOGRAPHY (all Google Fonts, font-display:swap, CJK everywhere) ===
- UI VOICE: 'IBM Plex Sans','Noto Sans SC',sans-serif — body 13px/1.5 400; emphasized meta 500; buttons 13px/500 sentence case; mod titles 15–16px/600.
- LABEL VOICE: 'IBM Plex Sans Condensed','Noto Sans SC',sans-serif 600 — page titles 20px UPPERCASE tracking 0.04em; panel/section/column labels 11px UPPERCASE tracking 0.08em in --text-3 (labels replace boxes as the grouping device); feed day separators same.
- TELEMETRY VOICE: 'IBM Plex Mono','Noto Sans SC',monospace — 12px readouts (IDs, sizes, versions, paths, timestamps, deltas); 11px in chips/stamps/kbd; 22px/500 ops-bar clock and stat numerals. font-variant-numeric:tabular-nums on EVERY numeric cell/count/date; numeric table columns right-aligned; sizes fixed precision "142.6 MB"; counts exact-with-commas in tables, "128.9k" in card footers. Mono never in headings or buttons.
- zh-CN: uppercase is moot for CJK — label voice renders Noto Sans SC 500, same box height, tracking 0.02em. Do NOT rely on "identical metrics": every nav item, button, chip, and stamp gets a reserved min-width sized to the longer of its EN/zh strings so EN↔中文 causes zero layout shift (grafted from D2/D3 per judges). Dates/numbers stay mono/ASCII in both locales; all relative/absolute time formatted client-side via Intl.RelativeTimeFormat / Intl.DateTimeFormat from epoch ints — zero time strings in the i18n dict.
- Scale: 11 / 12 / 13 / 15–16 / 20 / 22. No Tailwind default ladder.

=== 4. LAYOUT & SHELL ===
- Fixed left COMMAND RAIL 232px (collapsible to 56px icon rail, persisted): wordmark "GROUND STATION" condensed caps + Lucide radar glyph; nav items 36px (Updates / Library / Browse / Settings; active = --accent-text + --accent-tint pill sliding via layoutId); Updates carries mono pending-count badge; GAMES section label, then installed games (colored square glyph + name + mono mod count; includes zero-mod games like AoW4); clicking scopes Library/Browse. Rail footer: EN/中 toggle (two-segment, reserved widths).
- OPS BAR 40px on every page. Left: page title (condensed caps) + contextual controls. Right cluster, exact order: POLL readout · STEAM ● RUNNING/○ OFFLINE LED · LINK ● (SSE) · [4 AWAITING] amber badge (click → Updates) · ⟳ manual refresh · ◐/●/○ theme control · [⌘K] kbd chip. POLL readout resolution (judge-2 objection resolved): "T−03:10" updating at 10-SECOND granularity, split-flap roll only on displayed-digit change — never per-second; degraded states: "POLL FAILED · retrying" in --state-error mono when lastPoll.status=failed; "STALE 32m" amber when data old. The ops bar is the app's honesty surface: poller alive, Steam up, SSE connected, data freshness, helper active ("HELPER ●" chip while a browse session/action holds the child process).
- Content widths: Updates 920px log column (left-aligned); Library full-bleed with 24px gutters; Browse 1080px; Settings 640px. First screen is always data — no hero, no marketing band.
- Keyboard: Ctrl/Cmd+K command palette everywhere (search mods, jump to game, actions: Check now, Sync subscriptions, Fetch all, Switch language, Switch theme); '/' focuses search; J/K row navigation; Space expands; Enter opens detail; visible kbd hints as 1px-bordered 11px mono chips.

=== 5. COMPONENTS ===
- Radii: --r 4px everywhere; 2px chips/stamps/kbd. Cards: --bg-1 + 1px --line-1 + --edge-highlight (dark) / resting soft shadow (light); hover → --line-2 + --bg-2 (+hover shadow in light).
- Buttons: 28px height 13px/500; primary = --accent-fill with --on-accent text (light adds the #C07E17 border); secondary = 1px --line-2 transparent; ghost = --text-2, hover --bg-2; destructive = bordered --state-error; icon buttons 28×28. Destructive actions confirm INLINE (button morphs to "Confirm — unsubscribe? / 确认退订？", 3s revert). One primary per page.
- STAMPS (hero component; bilingual strings baked in, rendered per active locale): 10px mono UPPERCASE tracking 0.08em, 1px colored border, 2px radius, transparent fill, 6px dot inside. Exact set: "AWAITING STEAM / 待 Steam 发现" (--state-pending, dot breathes) · "QUEUED FOR LAUNCH / 待启动下载" (--state-pending-dim, static — the calm state for updates Steam has noticed but defers to game launch) · "DOWNLOADING / 下载中" (--state-downloading) · "FETCHED 14:32 / 已拉取 14:32" (--state-fetched) · "REMOVED / 已移除" and "BANNED / 已封禁" (--state-error) · "UNSUBSCRIBED · as of 12:04 / 已退订 · 数据截至 12:04" (--state-orphaned; when account data stale, renders "UNVERIFIED / 未验证" + "Sync to verify" affordance instead — never a false orphaned claim).
- Status elsewhere = 6px dot + plain 13px label. Only pills allowed = bordered per-game tags (heraldic hue text+border, no fill).
- ACQUISITION BRACKETS: four 8×8px 1.5px-stroke --accent-graphic corner brackets on pending (unseen) card heroes only; removed on fetch. Registration ticks: 6px L-marks in --line-1 on page-level frames, max twice per page.
- TABLES (Library/Browse): implemented as div-based CSS grid rows, NOT <table> (sticky <tr> is flaky — judge 2 resolution); 38px rows, 16px cell padding, 13px text, sticky 11px condensed-caps header, hairline dividers only (no zebra, no verticals, no outer card), hover = bg step, selected = --accent-tint + 2px --accent-graphic left edge; trailing action cell opacity 0→1 on hover/focus-within (max 3 + "⋯" menu: open folder / Steam page (steam://url/CommunityFilePage/<id>) / browser page / copy ID / force download / unsubscribe). Multi-select (SHIFT/CTRL) → bottom COMMAND TRAY slides up (--bg-3, hairline top, mono count, bulk unsubscribe/force-update/open folders). Virtualize lists >60 rows (virtua/react-window); images loading=lazy through /api/img.
- Inputs: --inset bg, 1px --line-2, 32px, --focus-ring. Toasts: bottom-right, --bg-3 + hairline + 2px state left edge + auto-dismiss progress hairline. Skeletons: mirror exact final geometry, 8 rows, shimmer 1.2s on rgba(255,255,255,0.05) (light: rgba(20,28,34,0.05)), 150ms delay before showing; no spinners on primary surfaces. Empty states: game glyph --text-3 + one sentence --text-2 + one amber action.
- THE SPINE (unified state narrative, Marquee graft per judges 2+3): every feed card's 3px left edge tells the whole story — amber breathing (unseen) → amber-dim static (queued-for-launch) → cyan indeterminate vertical sweep (Steam downloading now, fs.watch/SSE-driven; forced downloads use the same treatment) → the green fetched sequence. Progress, when byte counts exist, interpolates continuously with MOVE — never jumps.
- Changelog rendering: server-sanitized HTML only (see API); mono entry header "Update: Jul 13 @ 12:18"; empty-prose entries render "No notes provided / 无更新说明" in --text-3 italic — never blank; "Showing 3 of 60 · View all" loads more via before_ts cursor.

=== 6. PER-PAGE STRUCTURE ===
UPDATES (home, 920px log):
1. Pinned LAUNCH QUEUE strip: left "AWAITING STEAM (n)" compact chips (thumb + name + breathing dot, per-chip force-download on hover) + [Force download all]; right side of the strip: "RECEIVED TODAY" mini-log (✓ name hh:mm, last 5) — D2 ledger graft. At ≥1400px viewport the strip collapses into a sticky right SIDEBAR 260px (PENDING queue rows with per-row force-download / RECEIVED TODAY / stat strip "206 mods · 38.4 GB · 8 games", hairline-separated, no boxes).
2. Mission log: day separators (condensed caps + double hairline), event cards newest-first sorted by time_updated (detectedAt shown as "noticed 2h ago" mono). Card anatomy: 2.14:1 hero (max-height 180px, scrim, brackets when unseen) with title + game pill + UPDATED hh:mm on the scrim, stamp top-right, spine left; 2-line changelog excerpt clamp → EXPAND spring to full entries; mono footer (size, Δsize, subs) + hover actions (Force download / Steam / ⋯). Removed/banned events render as feed cards from snapshotted title/preview with --state-error spine — they are feed-worthy. Feed paginates via before_seq on scroll.
LIBRARY (full-bleed):
- Toolbar: [/ search] instant across name/author/id · FILTER CHIPS WITH LIVE COUNTS (D2 graft, replaces dropdown): "Awaiting {4}" "Queued {7}" "Downloading {1}" "Orphaned {2}" "Not installed {3}" "Removed {1}" + game/tag/source menus · sort menu (name, size, date added/subscribed, last updated, state) · column chooser (right-click header also toggles; persisted) · "206 mods · 38.4 GB".
- Per-game collapsible groups, sticky group headers (glyph + name + "90 mods · 14.2 GB" mono) over one continuous virtualized grid-table. Default columns: identity (64×30 thumb + name + author muted) / state dot+label / source badge (workshop|local) / targets ("1.7–1.9" mono pill from branchRange, neutral — never a verdict without installed-version data) / size (on-disk, workshop size in tooltip) / subs / UPDATED / ADDED (both kept — different questions) / hover actions. Rows for library_offline drives render dimmed with "DRIVE OFFLINE / 磁盘离线" chip, never dropped.
BROWSE (1080px):
- Game tab bar (heraldic underline slides via layoutId; non-browsable games e.g. Millennia show an explicit "no public Workshop browser" empty state, Library unaffected). Toolbar: search · sort tabs mapped to the validated enum (Most Popular + trend-window dropdown 7d/30d · Most Recent (updated) · Most Subscribed) · Tags sidebar. VIEW TOGGLE (judge graft): dense media rows (default: 112×52 thumb, title, author, ★ rating + count, mono subs/size/updated, bordered tags, state-aware Subscribe button — "✓ SUBSCRIBED" / "INSTALLED" chips cross-referenced server-side) ⇄ poster grid (2.14:1 tiles minmax(280px,1fr) — Steam 460×215 crops, NOT 4:3 — scrim carries title/author/subs, hover wakes color + reveals Subscribe). 50/page, [Load 50 more], stops at capped:true. Subscribing shows required-items dialog when the mod has children (list + Subscribe-all, mirroring Steam). First browse interaction shows one-time note "Starts the Steam helper (brief in-game flash) / 将启动 Steam 助手（短暂显示游戏中）"; HELPER ● chip in ops bar while the session lives.
SETTINGS (640px, flat hairline rows, condensed-caps section labels): Polling (interval 60–3600s) · Language EN/中文 · Theme ◐/●/○ · Changelog prefetch (on/off + queue cap) · Data folder (mono path + Open + Change→explicit migration flow with progress) · Image cache (size readout + Clear) · Diagnostics (lastPoll status, seq, helper state, per-game syncedAt, library warnings).
DETAIL VIEW (right sheet 560px over any page; real shadow — it floats): hero 3.4:1 with dominant-color wash + scrim; stats block mirroring Steam's (star rating + count with "Not enough ratings" under ~10 · posted · updated · file size workshop AND on-disk · current subscribers · favorites); author + avatar (link to profile); tags (version tags parsed and displayed); branchRange "Targets 1.7–1.9" pill; DEPENDENCIES BOTH DIRECTIONS (requires-list from children + required-by computed across the local cache; missing-dependency = --state-error row) + Required DLC box; sanitized BBCode description; changelog tab (cursor-paginated); action row: Subscribe/Unsubscribe · Force download · Open in Steam · Open in browser · Open folder · Copy ID · Launch game (steam://run/<appid>).

=== 7. MOTION SPEC (framer-motion; four named springs, nothing ad-hoc) ===
- SNAP {type:'spring', stiffness:600, damping:32, mass:0.7}: button press scale 0.97; whole-app press physics (D3 graft) — cards/rows/queue chips whileTap scale 0.985 with natural overshoot; toggle thumbs; nav pill + tab underline via layoutId; theme-control segment; checkbox ticks; badge pops (scale 1→1.25→1 on count increase).
- MOVE {stiffness:380, damping:34, mass:0.9}: FLIP/layout glides (feed inserts, list reorders, queue↔received row migration via per-mod layoutId), command-tray slide-up, continuous progress interpolation.
- EXPAND {stiffness:280, damping:30}: changelog height:auto expansion, body fade-in delayed 60ms; collapse 200ms ease-in tween.
- STAMP {stiffness:600, damping:22} (D2 graft, the thunk): on NEW SSE update-event arrival only, the AWAITING stamp punches in from {opacity:0, scale:1.4, rotate:-6°} → settled with one overshoot, ~380ms, 120ms after the card's layout insert settles. Quiet 120ms crossfade remains for pending→fetched stamp swaps.
- Durations: micro 80–220ms; page-level ≤140ms (fade + 4px translateY on route change). Entrances: Updates feed staggers first 5 cards 40ms apart on ROUTE ENTRY ONLY (never on poll ticks, keyed by event id); Library/Browse rows NEVER animate on initial render.
- THE MONEY MOMENT (pending→fetched via fs.watch): 4-beat ~700ms — (1) 3px spine sweeps amber→green top-to-bottom 400ms (2-stop gradient at 200% background-size animating background-position); (2) stamp crossfades 120ms, check icon draws (SVG pathLength 0→1, 260ms); (3) ONE green ring pulse box-shadow 0 0 0 6px rgba(85,193,134,0.25)→transparent 600ms — the only glow in the app; (4) brackets scale 1→1.1 + fade 200ms.
- UPDATE ALL cascade (D3 graft): button morphs into a progress pill via layout; queue chips/spines flip to DOWNLOADING top-to-bottom at 120ms intervals, making RimSort-style helper pacing visible; each completion fires the money moment.
- Rationed ambient motion: pending dots breathe opacity 0.55→1, 2.4s infinite; ops-bar AWAITING badge pulses exactly 3 cycles on increase then holds; downloading spine sweep 1.1s loop; radar icon rotates 360° once (600ms easeInOut) on each poll completion (D3 graft). Split-flap digit rolls (translateY ±100%, 180ms per changed digit) on POLL readout (10s granularity) and live counters.
- Hover: art wake saturate→1 + scale 1.015, 220ms; row bg 80ms; action reveal 150ms. Palette: scale 0.98→1 + fade 130ms from origin. Toasts: x 12px spring {480,38}.
- prefers-reduced-motion: all springs/slides → 80ms opacity-only; pulses, split-flap, sweeps disabled (hard swaps; pending dot becomes static dot + 1px amber ring); money moment = instant color+stamp swap. Off-screen items get no layout animations (virtualization-gated).
