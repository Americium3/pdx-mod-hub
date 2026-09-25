import path from 'node:path'
import * as cheerio from 'cheerio'
import { DATA_DIR } from './config.js'
import { hub } from './hub.js'
import { hostAllowed } from './images.js'
import { fetchWithDeadline } from './net.js'
import { readJson, writeJson } from './store.js'

// SteamID64 -> persona name + avatar resolution for Browse/Detail author display.
//
// Two paths:
//  - keyless (default): steamcommunity.com/profiles/<id64>/?xml=1, one profile
//    per request through a throttled single-flight queue (same politeness rules
//    as the changelog scraper: browser UA, spacing, backoff, circuit breaker —
//    steamcommunity can be blocked/slow on CN networks and must degrade).
//  - keyed (optional): ISteamUser/GetPlayerSummaries batches up to 100 ids per
//    call on api.steampowered.com when settings.steamWebApiKey is set.
//
// Resolution is ALWAYS asynchronous relative to API responses: routes serve
// whatever is cached and enqueue misses; the client re-asks /api/personas a
// few seconds later. Cache persists in data/personas.json with a 7-day TTL
// (15 min for misses) and is pruned to a bounded size.

const FILE = path.join(DATA_DIR, 'personas.json')
const TTL_SEC = 7 * 86_400
const NEG_TTL_SEC = 15 * 60
const SPACING_MS = 1_500
const REQUEST_TIMEOUT_MS = 8_000
const MAX_CACHE_ENTRIES = 5_000
const MAX_PENDING = 500
const BREAKER_THRESHOLD = 3
const BREAKER_COOLDOWN_MS = 5 * 60_000
const KEY_BATCH = 100

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const ID64 = /^\d{17}$/

interface PersonaEntry {
  name?: string
  avatarUrl?: string
  fetchedAt: number
  missing?: boolean
}

export interface Persona {
  name: string
  avatarUrl?: string
}

const nowSec = (): number => Math.floor(Date.now() / 1000)
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------- cache

let cache: Map<string, PersonaEntry> | null = null

function loadCache(): Map<string, PersonaEntry> {
  if (cache) return cache
  const raw = readJson<Record<string, PersonaEntry>>(FILE, {})
  cache = new Map(Object.entries(raw).filter(([id, e]) => ID64.test(id) && e && typeof e === 'object'))
  return cache
}

let saveTimer: NodeJS.Timeout | null = null

function saveNow(): Promise<void> {
  const c = loadCache()
  if (c.size > MAX_CACHE_ENTRIES) {
    const sorted = [...c.entries()].sort((a, b) => a[1].fetchedAt - b[1].fetchedAt)
    for (const [id] of sorted.slice(0, c.size - MAX_CACHE_ENTRIES)) c.delete(id)
  }
  return writeJson(FILE, Object.fromEntries(c))
}

function scheduleSave(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveNow()
  }, 2_000)
  saveTimer.unref()
}

/** Flush the debounced cache write (call before an explicit process exit). */
export function flushPersonas(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  return saveNow()
}

function fresh(entry: PersonaEntry | undefined): boolean {
  if (!entry) return false
  const ttl = entry.missing ? NEG_TTL_SEC : TTL_SEC
  return nowSec() - entry.fetchedAt < ttl
}

/** Cached persona (fresh, resolved) or null. Never triggers network. */
export function getPersona(id64: string | null | undefined): Persona | null {
  if (!id64 || !ID64.test(id64)) return null
  const entry = loadCache().get(id64)
  if (!entry || !fresh(entry) || entry.missing || !entry.name) return null
  return { name: entry.name, avatarUrl: entry.avatarUrl }
}

/** True when the id is fresh-negative-cached (deleted/private profile) — clients need not re-poll. */
export function isKnownMissing(id64: string): boolean {
  const e = loadCache().get(id64)
  return !!e && fresh(e) && e.missing === true
}

function store(id64: string, entry: PersonaEntry): void {
  loadCache().set(id64, entry)
  scheduleSave()
}

// ---------------------------------------------------------------- queue + breaker

const pending = new Set<string>()
let pumping = false

const breaker = { consecutiveFailures: 0, openUntil: 0 }

function breakerOpen(): boolean {
  return Date.now() < breaker.openUntil
}

function reportFailure(): void {
  breaker.consecutiveFailures++
  if (breaker.consecutiveFailures >= BREAKER_THRESHOLD) {
    breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS
    breaker.consecutiveFailures = 0
  }
}

function reportSuccess(): void {
  breaker.consecutiveFailures = 0
}

/**
 * Enqueue unresolved ids for background resolution (dedupes, bounded).
 * Returns how many ids were actually accepted into the queue.
 */
export function requestPersonas(ids: Array<string | null | undefined>): number {
  const c = loadCache()
  let queued = 0
  for (const id of ids) {
    if (!id || !ID64.test(id)) continue
    if (fresh(c.get(id))) continue
    if (pending.size >= MAX_PENDING) break
    pending.add(id)
    queued++
  }
  if (pending.size > 0) void pump()
  return queued
}

let resumeTimer: NodeJS.Timeout | null = null

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    while (pending.size > 0) {
      if (breakerOpen()) {
        // Schedule a guarded resume so the backlog drains once the breaker
        // cooldown expires even when no further request touches personas.
        if (pending.size > 0 && !resumeTimer) {
          resumeTimer = setTimeout(
            () => {
              resumeTimer = null
              void pump()
            },
            Math.max(0, breaker.openUntil - Date.now()) + 250,
          )
          resumeTimer.unref()
        }
        return
      }
      const key = (hub.settings.steamWebApiKey ?? '').trim()
      const batch = [...pending].slice(0, key ? KEY_BATCH : 1)
      for (const id of batch) pending.delete(id)
      try {
        if (key) await resolveWithKey(key, batch)
        else await resolveXml(batch[0])
        reportSuccess()
      } catch {
        reportFailure()
        // entries stay unresolved; a later requestPersonas retries them
      }
      await sleep(SPACING_MS)
    }
  } finally {
    pumping = false
  }
}

// ---------------------------------------------------------------- resolvers

/**
 * Only store avatar URLs that would pass the /api/img proxy allowlist
 * (single source of truth: images.ts hostAllowed) — never trust Steam
 * responses to hand us an arbitrary https URL.
 */
function safeAvatarUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && hostAllowed(u.hostname) ? raw : undefined
  } catch {
    return undefined
  }
}

async function resolveXml(id64: string): Promise<void> {
  const xml = await fetchWithDeadline(
    `https://steamcommunity.com/profiles/${id64}/?xml=1`,
    { headers: { 'User-Agent': BROWSER_UA } },
    REQUEST_TIMEOUT_MS,
    async res => {
      if (res.status === 429) throw new Error('rate limited')
      if (!res.ok) throw new Error(`profile xml HTTP ${res.status}`)
      return res.text()
    },
  )
  const $ = cheerio.load(xml, { xmlMode: true })
  const name = $('steamID').first().text().trim()
  const avatar = $('avatarMedium').first().text().trim()
  if (!name) {
    // deleted / never-set-up profile: negative-cache briefly
    store(id64, { missing: true, fetchedAt: nowSec() })
    return
  }
  store(id64, {
    name,
    avatarUrl: safeAvatarUrl(avatar),
    fetchedAt: nowSec(),
  })
}

async function resolveWithKey(key: string, ids: string[]): Promise<void> {
  const url =
    'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/' +
    `?key=${encodeURIComponent(key)}&steamids=${ids.join(',')}`
  const json = await fetchWithDeadline(url, {}, REQUEST_TIMEOUT_MS, async res => {
    if (!res.ok) throw new Error(`GetPlayerSummaries HTTP ${res.status}`)
    return (await res.json()) as {
      response?: { players?: Array<{ steamid?: string; personaname?: string; avatarmedium?: string }> }
    }
  })
  // Shape-level failures must hit the breaker (ids stay uncached, retried later)
  // instead of negative-caching the whole batch off a malformed response.
  const players = json.response?.players
  if (!Array.isArray(players)) throw new Error('GetPlayerSummaries malformed response')
  const seen = new Set<string>()
  for (const p of players) {
    const id = String(p.steamid ?? '')
    if (!ID64.test(id)) continue
    const name = typeof p.personaname === 'string' ? p.personaname.trim() : ''
    if (!name) continue // unseen -> negative-cached below, not refetched forever
    seen.add(id)
    store(id, {
      name,
      avatarUrl: typeof p.avatarmedium === 'string' ? safeAvatarUrl(p.avatarmedium) : undefined,
      fetchedAt: nowSec(),
    })
  }
  for (const id of ids) {
    if (!seen.has(id)) store(id, { missing: true, fetchedAt: nowSec() })
  }
}
