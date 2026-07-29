import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, loadSettings } from './config.js'
import { getChangelog } from './changelog.js'
import { readJson, writeJson } from './store.js'
import { broadcast } from './sse.js'
import { scanGames } from './steam/games.js'
import { findLibraries, findSteamRoot, isSteamRunning } from './steam/locate.js'
import { parseWorkshopAcf } from './steam/workshop.js'
import { fetchPublishedFileDetails } from './webapi.js'
import type {
  GameInfo,
  LocalMod,
  ModStatus,
  ModView,
  RemoteMod,
  Settings,
  SubsCache,
  UpdateEvent,
} from './types.js'

const REMOTE_FILE = path.join(DATA_DIR, 'remote.json')
const EVENTS_FILE = path.join(DATA_DIR, 'events.json')
const PENDING_FILE = path.join(DATA_DIR, 'pending.json')
const SUBS_DIR = path.join(DATA_DIR, 'subs')
const MAX_EVENTS = 500
const PREFETCH_PER_POLL = 10

export interface Hub {
  settings: Settings
  steamRoot: string | null
  libraries: string[]
  steamRunning: boolean
  games: GameInfo[]
  local: Map<string, LocalMod>
  remote: Map<string, RemoteMod>
  subs: Map<number, SubsCache>
  pending: Set<string>
  events: UpdateEvent[]
  lastPoll: number
  lastPollError?: string
  polling: boolean
}

export const hub: Hub = {
  settings: loadSettings(),
  steamRoot: null,
  libraries: [],
  steamRunning: false,
  games: [],
  local: new Map(),
  remote: new Map(),
  subs: new Map(),
  pending: new Set(),
  events: [],
  lastPoll: 0,
  polling: false,
}

const now = (): number => Math.floor(Date.now() / 1000)

export function initHub(): void {
  hub.remote = new Map(Object.entries(readJson<Record<string, RemoteMod>>(REMOTE_FILE, {})))
  hub.events = readJson<UpdateEvent[]>(EVENTS_FILE, [])
  hub.pending = new Set(readJson<string[]>(PENDING_FILE, []))
  if (fs.existsSync(SUBS_DIR)) {
    for (const f of fs.readdirSync(SUBS_DIR)) {
      const m = f.match(/^subs_(\d+)\.json$/)
      if (!m) continue
      const cache = readJson<SubsCache | null>(path.join(SUBS_DIR, f), null)
      if (cache) hub.subs.set(Number(m[1]), cache)
    }
  }
  rescanLocal()
}

export function rescanLocal(): void {
  hub.steamRoot = findSteamRoot(hub.settings.steamRootOverride)
  hub.libraries = hub.steamRoot ? findLibraries(hub.steamRoot) : []
  hub.steamRunning = isSteamRunning()
  hub.games = scanGames(hub.libraries)
  hub.local = new Map()
  for (const game of hub.games) {
    if (!game.workshopAcf) continue
    const scan = parseWorkshopAcf(game.appId, game.workshopAcf)
    game.modCount = scan.mods.length
    for (const mod of scan.mods) hub.local.set(mod.id, mod)
    const sub = hub.subs.get(game.appId)
    if (sub) game.syncedAt = sub.syncedAt
  }
  let pendingChanged = false
  for (const id of hub.pending) {
    if (hub.local.has(id)) {
      hub.pending.delete(id)
      pendingChanged = true
    }
  }
  if (pendingChanged) writeJson(PENDING_FILE, [...hub.pending])
}

function allKnownIds(): string[] {
  const ids = new Set<string>(hub.local.keys())
  for (const cache of hub.subs.values()) for (const id of cache.ids) ids.add(id)
  for (const id of hub.pending) ids.add(id)
  return [...ids]
}

function markDownloadedEvents(): boolean {
  let changed = false
  for (const ev of hub.events) {
    if (ev.downloadedAt) continue
    const local = hub.local.get(ev.modId)
    if (local && local.timeUpdated >= ev.ts) {
      ev.downloadedAt = now()
      changed = true
    }
  }
  return changed
}

export async function pollRemote(reason: string): Promise<void> {
  if (hub.polling) return
  hub.polling = true
  try {
    rescanLocal()
    const ids = allKnownIds()
    if (ids.length === 0) {
      hub.lastPoll = now()
      return
    }
    const fetched = await fetchPublishedFileDetails(ids)
    const fresh: UpdateEvent[] = []
    for (const rm of fetched) {
      if (rm.result !== 1 || !rm.timeUpdated) {
        hub.remote.set(rm.id, { ...hub.remote.get(rm.id), ...rm })
        continue
      }
      const prev = hub.remote.get(rm.id)
      const local = hub.local.get(rm.id)
      const baseline = prev?.timeUpdated ?? local?.timeUpdated ?? 0
      if (baseline > 0 && rm.timeUpdated > baseline) {
        const key = `${rm.id}:${rm.timeUpdated}`
        if (!hub.events.some(e => e.key === key)) {
          fresh.push({
            key,
            modId: rm.id,
            appId: rm.appId ?? local?.appId ?? 0,
            ts: rm.timeUpdated,
            detectedAt: now(),
            title: rm.title,
          })
        }
      }
      hub.remote.set(rm.id, rm)
    }
    if (fresh.length > 0) {
      hub.events.push(...fresh)
      hub.events.sort((a, b) => a.detectedAt - b.detectedAt || a.ts - b.ts)
      if (hub.events.length > MAX_EVENTS) hub.events.splice(0, hub.events.length - MAX_EVENTS)
    }
    markDownloadedEvents()
    hub.lastPoll = now()
    hub.lastPollError = undefined
    persist()
    broadcast('refresh', { reason, freshUpdates: fresh.length })
    if (hub.settings.changelogPrefetch) {
      for (const ev of fresh.slice(0, PREFETCH_PER_POLL)) {
        void getChangelog(ev.modId, 1, ev.ts)
          .then(() => broadcast('changelog-ready', { modId: ev.modId }))
          .catch(() => undefined)
      }
    }
  } catch (e) {
    hub.lastPollError = String(e instanceof Error ? e.message : e)
    broadcast('refresh', { reason: 'poll-error', error: hub.lastPollError })
  } finally {
    hub.polling = false
  }
}

export function onAcfChange(appId: number): void {
  rescanLocal()
  const changed = markDownloadedEvents()
  if (changed) writeJson(EVENTS_FILE, hub.events)
  broadcast('refresh', { reason: 'acf', appId })
}

export function saveSubs(cache: SubsCache): void {
  hub.subs.set(cache.appId, cache)
  writeJson(path.join(SUBS_DIR, `subs_${cache.appId}.json`), cache)
}

export function addPending(id: string): void {
  hub.pending.add(id)
  writeJson(PENDING_FILE, [...hub.pending])
}

export function removeFromSubs(appId: number, modId: string): void {
  const cache = hub.subs.get(appId)
  if (!cache) return
  cache.ids = cache.ids.filter(id => id !== modId)
  delete cache.states[modId]
  saveSubs(cache)
}

function persist(): void {
  writeJson(REMOTE_FILE, Object.fromEntries(hub.remote))
  writeJson(EVENTS_FILE, hub.events)
}

function statusOf(id: string, local?: LocalMod, rm?: RemoteMod, subscribed?: boolean): ModStatus {
  if (rm && rm.result !== 1) return 'removed'
  if (local && subscribed === false) return 'orphaned'
  if (local && rm?.timeUpdated && rm.timeUpdated > local.timeUpdated) return 'update-available'
  if (local && rm?.timeUpdated) return 'up-to-date'
  if (!local && (subscribed || hub.pending.has(id))) return 'not-installed'
  if (local) return 'unknown'
  return 'unknown'
}

export function buildModViews(): ModView[] {
  const subAppOf = new Map<string, number>()
  const subscribedSet = new Map<string, boolean>()
  for (const [appId, cache] of hub.subs) {
    for (const id of cache.ids) {
      subAppOf.set(id, appId)
      subscribedSet.set(id, true)
    }
  }
  const ids = new Set<string>([...hub.local.keys(), ...subAppOf.keys(), ...hub.pending])
  const views: ModView[] = []
  for (const id of ids) {
    const local = hub.local.get(id)
    const rm = hub.remote.get(id)
    const appId = local?.appId ?? rm?.appId ?? subAppOf.get(id) ?? 0
    const appSynced = hub.subs.has(appId)
    let subscribed: boolean | undefined = subscribedSet.get(id)
    if (subscribed === undefined && appSynced) subscribed = false
    if (subscribed === undefined && hub.pending.has(id)) subscribed = true
    views.push({
      id,
      appId,
      title: rm?.title ?? `Workshop item ${id}`,
      previewUrl: rm?.previewUrl,
      tags: rm?.tags ?? [],
      fileSize: rm?.fileSize,
      sizeOnDisk: local?.sizeBytes,
      timeCreated: rm?.timeCreated,
      timeUpdatedRemote: rm?.timeUpdated,
      timeUpdatedLocal: local?.timeUpdated,
      subscriptions: rm?.subscriptions,
      lifetimeSubscriptions: rm?.lifetimeSubscriptions,
      favorited: rm?.favorited,
      views: rm?.views,
      creator: rm?.creator,
      banned: rm?.banned,
      subscribed,
      status: statusOf(id, local, rm, subscribed),
    })
  }
  return views
}

export function buildState(): Record<string, unknown> {
  const mods = buildModViews()
  const pendingByApp = new Map<number, number>()
  for (const mod of mods) {
    if (mod.status === 'update-available') {
      pendingByApp.set(mod.appId, (pendingByApp.get(mod.appId) ?? 0) + 1)
    }
  }
  const games = hub.games.map(g => ({ ...g, updatesPending: pendingByApp.get(g.appId) ?? 0 }))
  return {
    settings: hub.settings,
    steamRoot: hub.steamRoot,
    steamRunning: hub.steamRunning,
    libraries: hub.libraries,
    lastPoll: hub.lastPoll,
    lastPollError: hub.lastPollError,
    polling: hub.polling,
    games,
    mods,
    feed: [...hub.events].sort((a, b) => b.ts - a.ts || b.detectedAt - a.detectedAt),
  }
}
