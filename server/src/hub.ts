import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, loadSettings } from './config.js'
import { getChangelog } from './changelog.js'
import { addEvents, currentSeq, initEvents, type NewFeedEvent } from './events.js'
import { readJson, writeJson } from './store.js'
import { broadcastPoke } from './sse.js'
import { scanGames } from './steam/games.js'
import { findLibraries, findSteamRoot, isSteamRunning } from './steam/locate.js'
import { parseWorkshopAcf, type WorkshopScan } from './steam/workshop.js'
import { fetchPublishedFileDetails, type RemoteFetchResult } from './webapi.js'
import type {
  AccountInfo,
  AcfModEntry,
  BranchRange,
  GameInfo,
  LastPoll,
  LibraryInfo,
  ModRecord,
  ModState,
  ModSummary,
  PersistedModRecord,
  RemoteMeta,
  Settings,
  StatePayload,
  SubsCache,
} from './types.js'

const MODS_FILE = path.join(DATA_DIR, 'mods.json')
const LEGACY_REMOTE_FILE = path.join(DATA_DIR, 'remote.json')
const PENDING_FILE = path.join(DATA_DIR, 'pending.json')
const SUBS_DIR = path.join(DATA_DIR, 'subs')

/** Account facts older than this render 'unverified' instead of 'orphaned'. */
const ACCOUNT_FRESH_SEC = 24 * 3600
const PARSE_RETRIES = 3
const PARSE_RETRY_MS = 250
const PREFETCH_PER_POLL = 10
const POLL_BACKOFF_CAP_MS = 2 * 3600_000
const MAX_BACKOFF_DOUBLINGS = 5

interface PendingEntry {
  appId: number
  addedAtTs: number
}

export interface Hub {
  settings: Settings
  steamRoot: string | null
  libraries: LibraryInfo[]
  steamRunning: boolean
  helperDepth: number
  games: GameInfo[]
  mods: Map<string, ModRecord>
  subs: Map<number, SubsCache>
  pending: Map<string, PendingEntry>
  lastPoll: LastPoll
  polling: boolean
  pollFailures: number
  /** Last good per-item snapshot per appId; the ACF diff runs against this. */
  acfByApp: Map<number, Map<string, AcfModEntry>>
  acfSeeded: boolean
}

export const hub: Hub = {
  settings: loadSettings(),
  steamRoot: null,
  libraries: [],
  steamRunning: false,
  helperDepth: 0,
  games: [],
  mods: new Map(),
  subs: new Map(),
  pending: new Map(),
  lastPoll: { at: 0, status: 'never' },
  polling: false,
  pollFailures: 0,
  acfByApp: new Map(),
  acfSeeded: false,
}

const now = (): number => Math.floor(Date.now() / 1000)
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------- init + migration

interface LegacyRemoteMod {
  id?: string
  result?: number
  appId?: number
  title?: string
  description?: string
  previewUrl?: string
  fileSize?: number
  timeCreated?: number
  timeUpdated?: number
  subscriptions?: number
  lifetimeSubscriptions?: number
  favorited?: number
  views?: number
  tags?: string[]
  creator?: string
  banned?: boolean
}

/**
 * One-time migration from the pre-contract data/remote.json. lastSeenRemoteTs is
 * seeded from the old cached timeUpdated so the first poll under the new scheme
 * only reports genuinely-new updates (no first-run flood).
 */
async function loadOrMigrateMods(): Promise<Record<string, PersistedModRecord>> {
  const existing = readJson<Record<string, PersistedModRecord> | null>(MODS_FILE, null)
  if (existing && typeof existing === 'object') return existing
  const legacy = readJson<Record<string, LegacyRemoteMod> | null>(LEGACY_REMOTE_FILE, null)
  if (!legacy) return {}
  const out: Record<string, PersistedModRecord> = {}
  for (const [id, rm] of Object.entries(legacy)) {
    if (!/^\d+$/.test(id) || !rm || typeof rm !== 'object') continue
    if (rm.result === 1) {
      out[id] = {
        appId: rm.appId ?? 0,
        source: 'workshop',
        lastSeenRemoteTs: rm.timeUpdated ?? null,
        remote: {
          fetchStatus: rm.banned ? 'banned' : 'ok',
          remoteTs: rm.timeUpdated,
          lastOkAt: 0,
          meta: {
            title: rm.title,
            description: rm.description,
            previewUrl: rm.previewUrl,
            fileSize: rm.fileSize,
            timeCreated: rm.timeCreated,
            subscriptions: rm.subscriptions,
            lifetimeSubscriptions: rm.lifetimeSubscriptions,
            favorited: rm.favorited,
            views: rm.views,
            tags: rm.tags,
            creator: rm.creator,
          },
        },
      }
    } else {
      out[id] = {
        appId: rm.appId ?? 0,
        source: 'workshop',
        lastSeenRemoteTs: null,
        remote: { fetchStatus: rm.result === 9 ? 'removed' : 'error' },
      }
    }
  }
  await writeJson(MODS_FILE, out)
  try {
    fs.renameSync(LEGACY_REMOTE_FILE, `${LEGACY_REMOTE_FILE}.v1.bak`)
  } catch {
    // leave it; mods.json now exists so migration will not re-run
  }
  console.log(`[hub] migrated ${Object.keys(out).length} records from legacy remote.json`)
  return out
}

function loadPending(): Map<string, PendingEntry> {
  const raw = readJson<unknown>(PENDING_FILE, null)
  const out = new Map<string, PendingEntry>()
  if (Array.isArray(raw)) {
    // legacy shape: string[] of mod ids
    const ts = now()
    for (const id of raw) if (typeof id === 'string' && /^\d+$/.test(id)) out.set(id, { appId: 0, addedAtTs: ts })
  } else if (raw && typeof raw === 'object') {
    for (const [id, v] of Object.entries(raw as Record<string, PendingEntry>)) {
      if (!/^\d+$/.test(id) || !v || typeof v !== 'object') continue
      out.set(id, { appId: v.appId ?? 0, addedAtTs: v.addedAtTs ?? now() })
    }
  }
  return out
}

function persistPending(): void {
  void writeJson(PENDING_FILE, Object.fromEntries(hub.pending))
}

export async function initHub(): Promise<void> {
  hub.settings = loadSettings()
  const persisted = await loadOrMigrateMods()
  hub.mods = new Map()
  for (const [id, p] of Object.entries(persisted)) {
    if (!/^\d+$/.test(id) || !p || typeof p !== 'object') continue
    hub.mods.set(id, {
      id,
      appId: p.appId ?? 0,
      source: p.source ?? 'workshop',
      acf: null,
      latestAcf: null,
      remote: p.remote ?? null,
      lastSeenRemoteTs: p.lastSeenRemoteTs ?? null,
    })
  }
  hub.subs = new Map()
  if (fs.existsSync(SUBS_DIR)) {
    for (const f of fs.readdirSync(SUBS_DIR)) {
      const m = f.match(/^subs_(\d+)\.json$/)
      if (!m) continue
      const cache = readJson<SubsCache | null>(path.join(SUBS_DIR, f), null)
      if (cache) hub.subs.set(Number(m[1]), cache)
    }
  }
  hub.pending = loadPending()
  initEvents(modId => {
    const meta = hub.mods.get(modId)?.remote?.meta
    return meta ? { title: meta.title, previewUrl: meta.previewUrl } : undefined
  })
  resolveLibraries()
  await scanAcfs() // first scan seeds snapshots silently — no event flood
}

// ---------------------------------------------------------------- record helpers

export function ensureRecord(id: string, appId = 0): ModRecord {
  let rec = hub.mods.get(id)
  if (!rec) {
    rec = {
      id,
      appId,
      source: 'workshop',
      acf: null,
      latestAcf: null,
      remote: null,
      lastSeenRemoteTs: null,
    }
    hub.mods.set(id, rec)
  } else if (rec.appId === 0 && appId > 0) {
    rec.appId = appId
  }
  return rec
}

export function persistMods(): Promise<void> {
  const out: Record<string, PersistedModRecord> = {}
  for (const [id, r] of hub.mods) {
    out[id] = {
      appId: r.appId,
      source: r.source,
      remote: r.remote,
      lastSeenRemoteTs: r.lastSeenRemoteTs,
    }
  }
  return writeJson(MODS_FILE, out)
}

const idSetMemo = new WeakMap<string[], Set<string>>()
function idSet(ids: string[]): Set<string> {
  let s = idSetMemo.get(ids)
  if (!s) {
    s = new Set(ids)
    idSetMemo.set(ids, s)
  }
  return s
}

/** Freshest account fact for a mod: optimistic pending entry vs the last sync. */
export function accountOf(id: string, appId: number): AccountInfo | null {
  const cache = hub.subs.get(appId)
  const p = hub.pending.get(id)
  if (p && p.addedAtTs >= (cache?.syncedAt ?? 0)) return { subscribed: true, asOf: p.addedAtTs }
  if (cache) return { subscribed: idSet(cache.ids).has(id), asOf: cache.syncedAt }
  return null
}

// ---------------------------------------------------------------- state derivation

/**
 * Key state split (must-fix 12):
 * - update-unseen: remoteTs > ACF latest_timeupdated — Steam has not noticed yet (hot).
 * - update-pending-launch: Steam noticed (latest_* advanced past installed) but
 *   defers the download to game launch (calm).
 * Orphaned requires FRESH account data; stale data renders 'unverified' (must-fix 10).
 */
export function stateOf(rec: ModRecord, account: AccountInfo | null, nowTs: number): ModState {
  const fetchStatus = rec.remote?.fetchStatus
  if (fetchStatus === 'removed') return 'removed'
  if (fetchStatus === 'banned') return 'banned'
  if (rec.acf) {
    if (account && !account.subscribed) {
      return nowTs - account.asOf <= ACCOUNT_FRESH_SEC ? 'orphaned' : 'unverified'
    }
    const remoteTs = rec.remote?.remoteTs ?? 0
    const latestTs = rec.latestAcf?.latestTimeupdated ?? rec.acf.acfTs
    if (remoteTs > latestTs) return 'update-unseen'
    const latestManifest = rec.latestAcf?.latestManifest
    if (latestManifest && rec.acf.manifest && latestManifest !== rec.acf.manifest) {
      return 'update-pending-launch'
    }
    if ((rec.latestAcf?.latestTimeupdated ?? 0) > rec.acf.acfTs) return 'update-pending-launch'
    return rec.remote?.remoteTs ? 'up-to-date' : 'unknown'
  }
  if (account?.subscribed) return 'not-installed'
  if (rec.latestAcf) return 'not-installed' // in ACF details but not yet downloaded
  return 'unknown'
}

const VERSION_TAG_RE = /^v?(\d+(?:\.\d+)+)\*?$/

/** branchRange {min,max} from version-shaped workshop tags (Vic3/EU5 author snapshots). */
export function branchRangeOf(tags: string[] | undefined): BranchRange | null {
  if (!tags || tags.length === 0) return null
  const found: Array<{ key: number[]; label: string }> = []
  for (const t of tags) {
    const m = VERSION_TAG_RE.exec(t.trim())
    if (!m) continue
    found.push({ key: m[1].split('.').map(Number), label: m[1] })
  }
  if (found.length === 0) return null
  found.sort((a, b) => {
    for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
      const d = (a.key[i] ?? 0) - (b.key[i] ?? 0)
      if (d !== 0) return d
    }
    return 0
  })
  return { min: found[0].label, max: found[found.length - 1].label }
}

// ---------------------------------------------------------------- libraries + games

export function resolveLibraries(): void {
  hub.steamRoot = findSteamRoot(hub.settings.steamRootOverride)
  hub.libraries = hub.steamRoot ? findLibraries(hub.steamRoot) : []
  hub.steamRunning = isSteamRunning()
  const prev = new Map(hub.games.map(g => [g.appId, g]))
  hub.games = scanGames(hub.libraries)
  for (const g of hub.games) {
    const p = prev.get(g.appId)
    if (!p) continue
    g.owned = p.owned ?? g.owned
    // Library went offline mid-run: keep last-known install/ACF facts and flag it
    // instead of letting the scan produce a false mass-uninstall (must-fix 15).
    if (p.libraryPath && !g.installed && !g.workshopAcf) {
      const lib = hub.libraries.find(l => l.path === p.libraryPath)
      if ((lib && !lib.reachable) || p.libraryOffline) {
        g.installed = p.installed
        g.hasWorkshopAcf = p.hasWorkshopAcf
        g.installDir = p.installDir
        g.libraryPath = p.libraryPath
        g.workshopAcf = p.workshopAcf
        g.libraryOffline = true
        g.warnings.push(`library offline: ${p.libraryPath}`)
      }
    }
  }
  for (const g of hub.games) {
    const sub = hub.subs.get(g.appId)
    if (sub) g.syncedAt = sub.syncedAt
  }
}

// ---------------------------------------------------------------- ACF scan + diff

async function parseAcfWithRetry(appId: number, file: string): Promise<WorkshopScan | null> {
  for (let attempt = 0; attempt < PARSE_RETRIES; attempt++) {
    const scan = parseWorkshopAcf(appId, file)
    if (scan) return scan
    await sleep(PARSE_RETRY_MS)
  }
  return null
}

let scanChain: Promise<void> = Promise.resolve()

/** Serialized ACF rescan + per-item snapshot diff ('downloaded' events, must-fix 14). */
export function scanAcfs(): Promise<void> {
  const next = scanChain.then(doScanAcfs, doScanAcfs)
  scanChain = next.catch(() => undefined)
  return next
}

async function doScanAcfs(): Promise<void> {
  const nowTs = now()
  const feedEvents: NewFeedEvent[] = []
  const nextByApp = new Map<number, Map<string, AcfModEntry>>()

  const candidates = new Map<number, GameInfo | undefined>()
  for (const g of hub.games) {
    if (g.workshopAcf || hub.acfByApp.has(g.appId)) candidates.set(g.appId, g)
  }
  for (const appId of hub.acfByApp.keys()) {
    if (!candidates.has(appId)) candidates.set(appId, undefined)
  }

  for (const [appId, game] of candidates) {
    const prevItems = hub.acfByApp.get(appId)
    if (game?.libraryOffline) {
      // unreachable drive: retain the last good snapshot, never diff-to-empty
      if (prevItems) nextByApp.set(appId, prevItems)
      continue
    }
    const file = game?.workshopAcf
    if (!file || !fs.existsSync(file)) {
      nextByApp.set(appId, new Map()) // genuine ACF deletion: diff to empty
      continue
    }
    const scan = await parseAcfWithRetry(appId, file)
    if (!scan) {
      // mid-write/corrupt ACF after retries: tolerate silently, keep last snapshot
      if (prevItems) nextByApp.set(appId, prevItems)
      continue
    }
    const items = new Map(scan.entries.map(e => [e.id, e]))
    nextByApp.set(appId, items)
    if (!hub.acfSeeded || items === prevItems) continue
    for (const [id, e] of items) {
      if (e.installedTs <= 0) continue
      const prevItem = prevItems?.get(id)
      const prevTs = prevItem?.installedTs ?? 0
      const manifestAdvanced =
        prevTs > 0 && !!e.manifest && !!prevItem?.manifest && e.manifest !== prevItem.manifest
      if (e.installedTs > prevTs || manifestAdvanced) {
        const meta = hub.mods.get(id)?.remote?.meta
        feedEvents.push({
          modId: id,
          appId,
          type: 'downloaded',
          ts: e.installedTs,
          detectedAt: nowTs,
          title: meta?.title,
          previewUrl: meta?.previewUrl,
        })
      }
    }
  }

  // Apply the scan to the record set.
  for (const rec of hub.mods.values()) {
    const items = nextByApp.get(rec.appId)
    if (items !== undefined && !items.has(rec.id)) {
      rec.acf = null
      rec.latestAcf = null
    }
  }
  for (const [appId, items] of nextByApp) {
    for (const [id, e] of items) {
      const rec = ensureRecord(id, appId)
      rec.appId = appId
      rec.acf =
        e.installedTs > 0
          ? { present: true, acfTs: e.installedTs, manifest: e.manifest, sizeOnDisk: e.sizeOnDisk }
          : null
      const latestTs = e.latestTimeupdated ?? (e.detailTs > 0 ? e.detailTs : undefined)
      rec.latestAcf =
        latestTs !== undefined || e.latestManifest !== undefined
          ? { latestTimeupdated: latestTs, latestManifest: e.latestManifest }
          : null
    }
  }
  hub.acfByApp = nextByApp
  for (const g of hub.games) g.modCount = nextByApp.get(g.appId)?.size ?? 0

  // Promote pending subscriptions that have landed on disk.
  let pendingChanged = false
  for (const id of [...hub.pending.keys()]) {
    if (hub.mods.get(id)?.acf) {
      hub.pending.delete(id)
      pendingChanged = true
    }
  }
  if (pendingChanged) persistPending()

  const seeded = hub.acfSeeded
  hub.acfSeeded = true
  if (seeded && feedEvents.length > 0) {
    const added = addEvents(feedEvents)
    if (added.length > 0) broadcastPoke('feed')
  }
}

/** Watcher entry point: an appworkshop ACF changed (created, rewritten, or deleted). */
export async function onAcfChange(_appId: number): Promise<void> {
  await scanAcfs()
  broadcastPoke('state')
}

/** Watcher entry point: libraryfolders.vdf changed. */
export async function onLibrariesChanged(): Promise<void> {
  resolveLibraries()
  await scanAcfs()
  broadcastPoke('state')
}

// ---------------------------------------------------------------- poller + events

function activeIds(): string[] {
  const out = new Set<string>()
  for (const items of hub.acfByApp.values()) for (const id of items.keys()) out.add(id)
  for (const [appId, cache] of hub.subs) {
    for (const id of cache.ids) {
      out.add(id)
      ensureRecord(id, appId)
    }
  }
  for (const [id, p] of hub.pending) {
    out.add(id)
    ensureRecord(id, p.appId)
  }
  return [...out]
}

function metaFrom(r: RemoteFetchResult): RemoteMeta {
  return {
    title: r.title,
    description: r.description,
    previewUrl: r.previewUrl,
    fileSize: r.fileSize,
    timeCreated: r.timeCreated,
    subscriptions: r.subscriptions,
    lifetimeSubscriptions: r.lifetimeSubscriptions,
    favorited: r.favorited,
    views: r.views,
    tags: r.tags,
    creator: r.creator,
  }
}

/**
 * Poll the keyless Web API and diff against lastSeenRemoteTs (must-fix 1, 11, 21).
 * - 'updated' iff newTs > lastSeenRemoteTs AND lastSeenRemoteTs != null AND the
 *   previous fetch was ok (suppresses private->public flips); first observation
 *   seeds silently.
 * - result=9 => removed, banned flag => banned; last-known-good meta is never
 *   overwritten by non-ok responses; transport failure touches nothing.
 */
export async function pollRemote(reason: string): Promise<void> {
  if (hub.polling) return
  hub.polling = true
  try {
    resolveLibraries()
    await scanAcfs()
    const ids = activeIds()
    if (ids.length === 0) {
      hub.lastPoll = { at: now(), status: 'ok' }
      hub.pollFailures = 0
      broadcastPoke('state')
      return
    }
    let fetched: Map<string, RemoteFetchResult>
    try {
      fetched = await fetchPublishedFileDetails(ids)
    } catch (e) {
      hub.pollFailures += 1
      hub.lastPoll = {
        at: now(),
        status: 'failed',
        error: String(e instanceof Error ? e.message : e),
      }
      broadcastPoke('state')
      return
    }
    const nowTs = now()
    const newEvents: NewFeedEvent[] = []
    for (const id of ids) {
      const r = fetched.get(id)
      if (!r) continue // missing from response = transport gap, not removal
      const rec = ensureRecord(id, r.appId ?? 0)
      if (r.appId) rec.appId = r.appId
      const prevStatus = rec.remote?.fetchStatus
      const prevMeta = rec.remote?.meta
      if (r.status === 'ok') {
        const newTs = r.timeUpdated ?? 0
        if (
          newTs > 0 &&
          rec.lastSeenRemoteTs !== null &&
          prevStatus === 'ok' &&
          newTs > rec.lastSeenRemoteTs
        ) {
          newEvents.push({
            modId: id,
            appId: rec.appId,
            type: 'updated',
            ts: newTs,
            detectedAt: nowTs,
            title: r.title ?? prevMeta?.title,
            previewUrl: r.previewUrl ?? prevMeta?.previewUrl,
          })
        }
        if (newTs > 0) rec.lastSeenRemoteTs = newTs
        rec.remote = {
          fetchStatus: 'ok',
          remoteTs: newTs > 0 ? newTs : rec.remote?.remoteTs,
          lastOkAt: nowTs,
          meta: metaFrom(r),
        }
      } else if (r.status === 'removed' || r.status === 'banned') {
        if (prevStatus === 'ok') {
          newEvents.push({
            modId: id,
            appId: rec.appId,
            type: r.status,
            ts: nowTs,
            detectedAt: nowTs,
            title: prevMeta?.title ?? r.title,
            previewUrl: prevMeta?.previewUrl ?? r.previewUrl,
          })
        }
        rec.remote = {
          fetchStatus: r.status,
          remoteTs: rec.remote?.remoteTs ?? r.timeUpdated,
          lastOkAt: rec.remote?.lastOkAt,
          // banned responses still carry details; seed meta only if we had none
          meta: prevMeta ?? (r.status === 'banned' ? metaFrom(r) : undefined),
        }
      } else {
        // private / error: keep last-known-good meta + remoteTs untouched
        rec.remote = { ...(rec.remote ?? {}), fetchStatus: r.status }
      }
    }
    hub.lastPoll = { at: now(), status: 'ok' }
    hub.pollFailures = 0
    const added = addEvents(newEvents)
    await persistMods()
    broadcastPoke('state', { reason })
    if (added.length > 0) broadcastPoke('feed')
    if (hub.settings.changelogPrefetch) {
      // Stage-B replaces this with the global changelog queue + prefetch cap.
      const fresh = added.filter(e => e.type === 'updated').slice(0, PREFETCH_PER_POLL)
      for (const ev of fresh) {
        void getChangelog(ev.modId, 1, ev.ts).catch(() => undefined)
      }
    }
  } finally {
    hub.polling = false
  }
}

// ---------------------------------------------------------------- poll scheduling

let pollTimer: NodeJS.Timeout | null = null

function nextPollDelayMs(): number {
  const base = Math.max(60, hub.settings.pollIntervalSec) * 1000
  if (hub.pollFailures === 0) return base
  // exponential backoff on failure (must-fix 21)
  return Math.min(base * 2 ** Math.min(hub.pollFailures, MAX_BACKOFF_DOUBLINGS), POLL_BACKOFF_CAP_MS)
}

function armPoll(delayMs: number): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = setTimeout(() => {
    void pollRemote('interval').finally(() => armPoll(nextPollDelayMs()))
  }, delayMs)
}

export function startPollLoop(initialDelayMs = 3_000): void {
  armPoll(initialDelayMs)
}

/** Re-arm the poll timer (settings change); no-op until startPollLoop ran. */
export function reschedulePoll(): void {
  if (pollTimer) armPoll(nextPollDelayMs())
}

export function refreshSteamRunning(): void {
  const cur = isSteamRunning()
  if (cur !== hub.steamRunning) {
    hub.steamRunning = cur
    broadcastPoke('state')
  }
}

// ---------------------------------------------------------------- account mutations

export function saveSubs(cache: SubsCache): void {
  hub.subs.set(cache.appId, cache)
  const game = hub.games.find(g => g.appId === cache.appId)
  if (game) game.syncedAt = cache.syncedAt
  void writeJson(path.join(SUBS_DIR, `subs_${cache.appId}.json`), cache)
}

/** Optimistic pending subscription; promoted (and cleared) when its ACF entry lands. */
export function addPending(id: string, appId: number): void {
  hub.pending.set(id, { appId, addedAtTs: now() })
  ensureRecord(id, appId)
  persistPending()
}

/** Optimistic subscribe: add to the app's sync cache without claiming a fresh sync. */
export function addToSubs(appId: number, modId: string): void {
  const cache = hub.subs.get(appId)
  if (!cache || cache.ids.includes(modId)) return
  cache.ids = [...cache.ids, modId]
  saveSubs(cache)
}

export function removeFromSubs(appId: number, modId: string): void {
  hub.pending.delete(modId)
  persistPending()
  const cache = hub.subs.get(appId)
  if (!cache) return
  cache.ids = cache.ids.filter(id => id !== modId)
  delete cache.states[modId]
  saveSubs(cache)
}

/** Wrap helper invocations so /api/state can expose helperActive. */
export async function trackHelper<T>(fn: () => Promise<T>): Promise<T> {
  hub.helperDepth += 1
  if (hub.helperDepth === 1) broadcastPoke('state')
  try {
    return await fn()
  } finally {
    hub.helperDepth -= 1
    if (hub.helperDepth === 0) broadcastPoke('state')
  }
}

// Stage-B wiring point: the watcher handle's refresh, injected by index.ts, so
// settings changes (steamRootOverride) can re-arm directory watchers.
let watcherRefreshHook: () => void = () => undefined
export function setWatcherRefreshHook(fn: () => void): void {
  watcherRefreshHook = fn
}
export function requestWatcherRefresh(): void {
  watcherRefreshHook()
}

// ---------------------------------------------------------------- views

export function buildState(): StatePayload {
  const nowTs = now()
  const mods: ModSummary[] = []
  const pendingByApp = new Map<number, number>()
  for (const id of activeIds()) {
    const rec = hub.mods.get(id)
    if (!rec) continue
    const account = accountOf(id, rec.appId)
    const state = stateOf(rec, account, nowTs)
    if (state === 'update-unseen' || state === 'update-pending-launch') {
      pendingByApp.set(rec.appId, (pendingByApp.get(rec.appId) ?? 0) + 1)
    }
    const meta = rec.remote?.meta
    mods.push({
      id,
      appId: rec.appId,
      title: meta?.title ?? `Workshop item ${id}`,
      state,
      remoteTs: rec.remote?.remoteTs ?? null,
      acfTs: rec.acf?.acfTs ?? null,
      previewUrl: meta?.previewUrl,
      sizeOnDisk: rec.acf?.sizeOnDisk,
      fileSize: meta?.fileSize,
      subs: meta?.subscriptions,
      branchRange: branchRangeOf(meta?.tags),
      source: rec.source,
    })
  }
  const games = hub.games.map(g => ({ ...g, updatesPending: pendingByApp.get(g.appId) ?? 0 }))
  return {
    seq: currentSeq(),
    settings: hub.settings,
    steamRoot: hub.steamRoot,
    libraries: hub.libraries,
    steamRunning: hub.steamRunning,
    helperActive: hub.helperDepth > 0,
    polling: hub.polling,
    lastPoll: hub.lastPoll,
    games,
    mods,
  }
}

/** Full detail for GET /api/mods/:id (description/tags/stats stay off /api/state). */
export function buildModDetail(id: string): Record<string, unknown> | null {
  const rec = hub.mods.get(id)
  if (!rec) return null
  const account = accountOf(id, rec.appId)
  const meta = rec.remote?.meta
  return {
    id,
    appId: rec.appId,
    source: rec.source,
    state: stateOf(rec, account, now()),
    title: meta?.title ?? `Workshop item ${id}`,
    description: meta?.description ?? '',
    previewUrl: meta?.previewUrl,
    tags: meta?.tags ?? [],
    creator: meta?.creator,
    timeCreatedTs: meta?.timeCreated ?? null,
    remoteTs: rec.remote?.remoteTs ?? null,
    acfTs: rec.acf?.acfTs ?? null,
    lastSeenRemoteTs: rec.lastSeenRemoteTs,
    lastOkAtTs: rec.remote?.lastOkAt ?? null,
    fetchStatus: rec.remote?.fetchStatus ?? null,
    fileSize: meta?.fileSize ?? null,
    sizeOnDisk: rec.acf?.sizeOnDisk ?? null,
    manifest: rec.acf?.manifest ?? null,
    latestAcf: rec.latestAcf,
    subs: meta?.subscriptions ?? null,
    lifetimeSubs: meta?.lifetimeSubscriptions ?? null,
    favorited: meta?.favorited ?? null,
    views: meta?.views ?? null,
    account,
    branchRange: branchRangeOf(meta?.tags),
    // Stage-B extension point: dependency graph (children[] + reverse index).
    dependencies: { requires: [], requiredBy: [] },
  }
}
