import path from 'node:path'
import * as cheerio from 'cheerio'
import { DATA_DIR } from './config.js'
import { fetchWithDeadline } from './net.js'
import { sanitizeChangelogHtml } from './sanitize.js'
import { readJson, writeJson } from './store.js'

// Changelog engine (must-fix 2, 17).
//
// The public surface is a CURSOR over a locally-ordered entry list keyed
// (modId, ts, ordinalWithinTs) — Steam's ?p=N pagination is strictly a fetch
// side detail. Head refresh fetches p1 whenever remoteTs advances past the
// newest cached ts, then walks deeper pages until it overlaps the cache
// (30-page hard cap); same-ts entry groups are overwritten on refetch so
// author edits land. Everything is sanitized BEFORE caching.
//
// All network goes through ONE global queue: single worker, 4s spacing,
// interactive requests ahead of prefetch (prefetch capped), per-modId
// in-flight dedup (an expand joins the pending sync), 8s per-request timeout,
// 429 => exponential backoff on the queue, and a per-host circuit breaker so
// a stalled steamcommunity.com (CN networks) degrades to "unavailable"
// without wedging anything.

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const PAGE_SIZE = 10 // entries per steamcommunity changelog page
const WALK_CAP = 30 // hard cap on the overlap walk
const PREFETCH_WALK_CAP = 3 // prefetch never holds the queue for a deep walk
const SPACING_MS = 4_000
const REQUEST_TIMEOUT_MS = 8_000
const PREFETCH_QUEUE_CAP = 20
const NEG_UNAVAILABLE_TTL_SEC = 6 * 3600
const NEG_MISSING_TTL_SEC = 15 * 60
const BREAKER_THRESHOLD = 4 // consecutive failures before the circuit opens
const BREAKER_COOLDOWN_BASE_MS = 60_000
const BREAKER_COOLDOWN_CAP_MS = 15 * 60_000
const RATE_BACKOFF_BASE_MS = 30_000
const RATE_BACKOFF_CAP_MS = 10 * 60_000

const nowSec = (): number => Math.floor(Date.now() / 1000)
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------- wire + cache types

export interface ChangelogWireEntry {
  ts: number
  ord: number
  date: string
  html: string
  fetchedAt: number
}

export interface ChangelogCursorPage {
  entries: ChangelogWireEntry[]
  hasMore: boolean
  syncedThroughTs: number | null
  /** ok = served (possibly stale) content; unavailable = negative-cached error
   *  page; error = transient fetch failure with nothing cached to serve. */
  status: 'ok' | 'unavailable' | 'error'
  checkedAt?: number
}

interface StoredEntry {
  ts: number
  ord: number
  date: string
  html: string // sanitized before caching
  fetchedAt: number
}

interface NegativeRecord {
  status: 'unavailable' | 'missing'
  checkedAt: number
}

interface CacheV2 {
  version: 2
  fetchedAt: number
  /** Newest entry ts the cache is synced through (0 = never synced). */
  syncedThroughTs: number
  /** True once the oldest page has been reached. */
  complete: boolean
  /** Sorted ts desc, ord asc. */
  entries: StoredEntry[]
  negative?: NegativeRecord
}

interface LegacyPage {
  entries?: Array<{ ts?: number; date?: string; html?: string }>
  hasMore?: boolean
}

interface LegacyCacheV1 {
  fetchedAt?: number
  newestTs?: number
  pages?: Record<string, LegacyPage>
}

function emptyCache(): CacheV2 {
  return { version: 2, fetchedAt: 0, syncedThroughTs: 0, complete: false, entries: [] }
}

function cachePath(modId: string): string {
  if (!/^\d+$/.test(modId)) throw new Error('bad mod id')
  return path.join(DATA_DIR, 'changelogs', `${modId}.json`)
}

// In-memory caches are authoritative (disk writes are async + queued); a
// disk re-read after saveCache would race the write.
const memCache = new Map<string, CacheV2>()

/** Load the v2 cache, migrating the stage-A page-keyed format in place. */
function loadCache(modId: string): CacheV2 {
  const mem = memCache.get(modId)
  if (mem) return mem
  const cache = loadCacheFromDisk(modId)
  memCache.set(modId, cache)
  return cache
}

function loadCacheFromDisk(modId: string): CacheV2 {
  const raw = readJson<CacheV2 | LegacyCacheV1 | null>(cachePath(modId), null)
  if (!raw || typeof raw !== 'object') return emptyCache()
  if ((raw as CacheV2).version === 2 && Array.isArray((raw as CacheV2).entries)) {
    return raw as CacheV2
  }
  const legacy = raw as LegacyCacheV1
  const cache = emptyCache()
  cache.fetchedAt = legacy.fetchedAt ?? 0
  const pages = legacy.pages ?? {}
  const pageNums = Object.keys(pages)
    .map(Number)
    .filter(n => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b)
  const flat: Array<{ ts: number; date: string; html: string }> = []
  let lastPage = 0
  let contiguous = true
  for (const p of pageNums) {
    if (p !== lastPage + 1) contiguous = false
    if (!contiguous) break // only a contiguous prefix maps onto the entry list
    lastPage = p
    for (const e of pages[String(p)]?.entries ?? []) {
      if (typeof e.ts !== 'number' || e.ts <= 0) continue
      flat.push({ ts: e.ts, date: e.date ?? '', html: e.html ?? '' })
    }
    if (pages[String(p)]?.hasMore === false) {
      cache.complete = true
      break
    }
  }
  let ord = 0
  let prevTs = -1
  for (const e of flat) {
    ord = e.ts === prevTs ? ord + 1 : 0
    prevTs = e.ts
    cache.entries.push({
      ts: e.ts,
      ord,
      date: e.date,
      // legacy html came from a narrower whitelist; re-running the full
      // pipeline is idempotent for it and upgrades the guarantees
      html: sanitizeChangelogHtml(e.html),
      fetchedAt: cache.fetchedAt || nowSec(),
    })
  }
  sortEntries(cache.entries)
  cache.syncedThroughTs = cache.entries[0]?.ts ?? legacy.newestTs ?? 0
  if (cache.entries.length > 0 || cache.fetchedAt > 0) {
    void writeJson(cachePath(modId), cache) // persist the migration
  }
  return cache
}

function saveCache(modId: string, cache: CacheV2): void {
  memCache.set(modId, cache)
  void writeJson(cachePath(modId), cache)
}

function sortEntries(entries: StoredEntry[]): void {
  entries.sort((a, b) => b.ts - a.ts || a.ord - b.ord)
}

function negativeFresh(neg: NegativeRecord | undefined, kind: NegativeRecord['status']): boolean {
  if (!neg || neg.status !== kind) return false
  const ttl = kind === 'unavailable' ? NEG_UNAVAILABLE_TTL_SEC : NEG_MISSING_TTL_SEC
  return nowSec() - neg.checkedAt < ttl
}

// ---------------------------------------------------------------- errors

/** HTTP-200 "Steam Community :: Error" page — negative-cached 6h. */
export class ChangelogUnavailableError extends Error {}
/** Circuit breaker open — transient, never negative-cached. */
export class ChangelogBreakerOpenError extends Error {}
class RateLimitedError extends Error {}

// ---------------------------------------------------------------- global fetch queue

interface QueueTask {
  priority: 0 | 1 // 0 interactive, 1 prefetch
  run: () => Promise<void>
}

const interactiveQ: QueueTask[] = []
const prefetchQ: QueueTask[] = []
let pumping = false
let nextAllowedAt = 0
let rateBackoffLevel = 0

const breaker = {
  host: 'steamcommunity.com',
  consecutiveFailures: 0,
  openUntil: 0,
  level: 0,
}

function breakerOpen(): boolean {
  return Date.now() < breaker.openUntil
}

function breakerReportSuccess(): void {
  breaker.consecutiveFailures = 0
  breaker.level = 0
  rateBackoffLevel = 0
}

function breakerReportFailure(): void {
  breaker.consecutiveFailures++
  // half-open probe (level > 0) reopens on the first strike
  const threshold = breaker.level > 0 ? 1 : BREAKER_THRESHOLD
  if (breaker.consecutiveFailures >= threshold) {
    const cooldown = Math.min(
      BREAKER_COOLDOWN_BASE_MS * 2 ** breaker.level,
      BREAKER_COOLDOWN_CAP_MS,
    )
    breaker.openUntil = Date.now() + cooldown
    breaker.level++
    breaker.consecutiveFailures = 0
    console.warn(
      `[changelog] circuit breaker OPEN for ${breaker.host} (${Math.round(cooldown / 1000)}s)`,
    )
  }
}

function reportRateLimited(): void {
  rateBackoffLevel++
  const delay = Math.min(RATE_BACKOFF_BASE_MS * 2 ** (rateBackoffLevel - 1), RATE_BACKOFF_CAP_MS)
  nextAllowedAt = Math.max(nextAllowedAt, Date.now() + delay)
  console.warn(`[changelog] 429 — queue backoff ${Math.round(delay / 1000)}s`)
}

function enqueue(task: QueueTask): void {
  if (task.priority === 0) interactiveQ.push(task)
  else prefetchQ.push(task)
  void pump()
}

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    for (;;) {
      const task = interactiveQ.shift() ?? prefetchQ.shift()
      if (!task) return
      const wait = nextAllowedAt - Date.now()
      if (wait > 0) await sleep(wait)
      await task.run() // task wrappers never throw
      nextAllowedAt = Math.max(nextAllowedAt, Date.now() + SPACING_MS)
    }
  } finally {
    pumping = false
  }
}

/** Debug/smoke visibility into queue + breaker state. */
export function changelogQueueStats(): Record<string, unknown> {
  return {
    interactiveQueued: interactiveQ.length,
    prefetchQueued: prefetchQ.length,
    inflight: [...inflight.keys()],
    breakerOpen: breakerOpen(),
    breakerLevel: breaker.level,
    rateBackoffLevel,
  }
}

// ---------------------------------------------------------------- page fetch + parse

interface RawEntry {
  ts: number
  date: string
  html: string // sanitized
}

interface FetchedPage {
  entries: RawEntry[] // page order (newest first)
  hasMore: boolean
}

async function fetchPageFromSteam(modId: string, page: number): Promise<FetchedPage> {
  if (breakerOpen()) throw new ChangelogBreakerOpenError(breaker.host)
  const url = `https://steamcommunity.com/sharedfiles/filedetails/changelog/${modId}?p=${page}`
  let html: string
  try {
    html = await fetchWithDeadline(
      url,
      { headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'en-US,en;q=0.9' } },
      REQUEST_TIMEOUT_MS,
      async res => {
        if (res.status === 429) throw new RateLimitedError('HTTP 429')
        if (!res.ok) throw new Error(`changelog HTTP ${res.status}`)
        return res.text()
      },
    )
  } catch (e) {
    if (e instanceof RateLimitedError) {
      reportRateLimited()
    } else {
      breakerReportFailure()
    }
    throw e
  }
  const $ = cheerio.load(html)
  // Bad/removed ids return HTTP 200 with an error page (must-fix 17).
  if ($('title').text().includes('Steam Community :: Error')) {
    breakerReportSuccess() // the host answered; this is a content-level miss
    throw new ChangelogUnavailableError(modId)
  }
  const entries: RawEntry[] = []
  $('div.changeLogCtn').each((_, ctn) => {
    const p = $(ctn).find('p[id]').first()
    const ts = Number(p.attr('id'))
    if (!Number.isFinite(ts) || ts <= 0) return
    const date = $(ctn).find('.changelog.headline').first().text().trim()
    // Sanitize BEFORE caching: cheerio whitelist walker + DOMPurify final pass.
    const raw = p.html() ?? ''
    entries.push({ ts, date, html: sanitizeChangelogHtml(raw) })
  })
  breakerReportSuccess()
  return { entries, hasMore: entries.length >= PAGE_SIZE }
}

// ---------------------------------------------------------------- merge

/**
 * Merge a fetched run of entries (page order, newest first) into the cache.
 * Same-ts groups are REPLACED wholesale so author edits are picked up; ord is
 * the ordinal within the ts as encountered in the fetched run.
 */
function mergeRun(cache: CacheV2, run: RawEntry[]): number {
  if (run.length === 0) return 0
  const fetchedAt = nowSec()
  const groups = new Map<number, StoredEntry[]>()
  for (const e of cache.entries) {
    const g = groups.get(e.ts)
    if (g) g.push(e)
    else groups.set(e.ts, [e])
  }
  const replaced = new Set<number>()
  for (const e of run) {
    if (!replaced.has(e.ts)) {
      groups.set(e.ts, []) // same-ts overwrite on refetch (author edits)
      replaced.add(e.ts)
    }
    const g = groups.get(e.ts) as StoredEntry[]
    g.push({ ts: e.ts, ord: g.length, date: e.date, html: e.html, fetchedAt })
  }
  const next: StoredEntry[] = []
  for (const g of groups.values()) next.push(...g)
  sortEntries(next)
  const grew = next.length - cache.entries.length
  cache.entries = next
  cache.fetchedAt = fetchedAt
  if (cache.entries.length > 0) {
    cache.syncedThroughTs = Math.max(cache.syncedThroughTs, cache.entries[0].ts)
  }
  return grew
}

// ---------------------------------------------------------------- sync operations

/**
 * Head refresh: fetch p1, then walk deeper until a fetched page overlaps the
 * cached head (an entry with ts <= previous syncedThroughTs), the last page is
 * reached, or the walk cap trips. With an empty cache only p1 is taken (older
 * history is pulled on demand by the cursor).
 */
async function syncHead(modId: string, cache: CacheV2, remoteTs: number | undefined, walkCap: number): Promise<void> {
  const boundaryTs = cache.entries[0]?.ts ?? 0
  const run: RawEntry[] = []
  let page = 1
  let overlapped = false
  let sawEnd = false
  for (;;) {
    if (page > 1) await sleep(SPACING_MS) // in-walk pacing on the single worker
    const fetched = await fetchPageFromSteam(modId, page)
    run.push(...fetched.entries)
    if (!fetched.hasMore) {
      sawEnd = true
      break
    }
    if (boundaryTs === 0) break // empty cache: head page only
    if (fetched.entries.some(e => e.ts <= boundaryTs)) {
      overlapped = true
      break
    }
    if (page >= walkCap) {
      console.warn(`[changelog] ${modId}: overlap walk hit the ${walkCap}-page cap`)
      break
    }
    page++
  }
  // Cap-tripped walk that never overlapped the cached head leaves a gap between
  // the fetched run's tail and the pre-existing older entries — merging them
  // would make cache.entries non-contiguous, breaking syncOlder's page math
  // (floor(entries.length/PAGE_SIZE)+1). Drop the stale older entries and keep
  // only the contiguous fetched prefix; the cursor re-pulls the tail on demand.
  const capGap = boundaryTs !== 0 && !overlapped && page >= walkCap
  if (capGap) cache.entries = []
  mergeRun(cache, run)
  cache.fetchedAt = nowSec() // even an empty page is a successful sync
  if (sawEnd) cache.complete = true
  else if (boundaryTs === 0 || capGap) {
    // cap-tripped walk may have left a gap below the fetched run; the cursor
    // treats the tail as incomplete and re-fetches older pages on demand
    cache.complete = false
  }
  const newestTs = cache.entries[0]?.ts ?? 0
  if (remoteTs !== undefined && remoteTs > newestTs) {
    // Steam updated the item but its changelog page does not list the entry
    // yet — negative record so we do not hammer p1 (15min TTL, must-fix 17).
    cache.negative = { status: 'missing', checkedAt: nowSec() }
  } else if (cache.negative?.status === 'missing') {
    delete cache.negative
  }
  saveCache(modId, cache)
}

/** Fetch the page just past the cached tail (cursor paging into history). */
async function syncOlder(modId: string, cache: CacheV2): Promise<void> {
  let page = Math.floor(cache.entries.length / PAGE_SIZE) + 1
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(SPACING_MS)
    const fetched = await fetchPageFromSteam(modId, page)
    const grew = mergeRun(cache, fetched.entries)
    cache.fetchedAt = nowSec()
    if (!fetched.hasMore) {
      cache.complete = true
      break
    }
    if (grew > 0) break
    page++ // head insertions shifted the pages; probe one page deeper
  }
  saveCache(modId, cache)
}

// ---------------------------------------------------------------- scheduling

const inflight = new Map<string, Promise<void>>()

function scheduleSync(
  modId: string,
  kind: 'head' | 'older',
  priority: 0 | 1,
  remoteTs?: number,
): Promise<void> {
  const pending = inflight.get(modId)
  if (pending) return pending // expand joins the pending promise (dedup)
  if (priority === 1 && prefetchQ.length >= PREFETCH_QUEUE_CAP) {
    return Promise.resolve() // prefetch is best-effort; cap the queue
  }
  let resolve!: () => void
  let reject!: (e: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  inflight.set(modId, promise)
  promise.catch(() => undefined) // owned rejection; joiners attach their own handlers
  enqueue({
    priority,
    run: async () => {
      try {
        const cache = loadCache(modId)
        if (kind === 'head') {
          await syncHead(modId, cache, remoteTs, priority === 0 ? WALK_CAP : PREFETCH_WALK_CAP)
        } else {
          await syncOlder(modId, cache)
        }
        resolve()
      } catch (e) {
        if (e instanceof ChangelogUnavailableError) {
          const cache = loadCache(modId)
          cache.negative = { status: 'unavailable', checkedAt: nowSec() }
          saveCache(modId, cache)
        }
        reject(e)
      } finally {
        inflight.delete(modId)
      }
    },
  })
  return promise
}

// ---------------------------------------------------------------- public API

export interface ChangelogCursorQuery {
  beforeTs?: number
  limit: number
}

/**
 * Cursor read (must-fix 2): entries strictly older than beforeTs (all newest
 * when omitted), never touching Steam pagination on the wire. Interactive
 * priority; a stale head triggers a queued sync the caller awaits, and paging
 * past the cached tail pulls one deeper page. Fetch failures degrade to the
 * cached content instead of failing the request.
 */
export async function getChangelogCursor(
  modId: string,
  q: ChangelogCursorQuery,
  remoteTs?: number,
): Promise<ChangelogCursorPage> {
  let cache = loadCache(modId)
  if (negativeFresh(cache.negative, 'unavailable')) {
    return {
      entries: [],
      hasMore: false,
      syncedThroughTs: cache.syncedThroughTs || null,
      status: 'unavailable',
      checkedAt: cache.negative?.checkedAt,
    }
  }

  let syncFailed = false
  let unavailable = false
  const runSync = async (kind: 'head' | 'older'): Promise<void> => {
    try {
      await scheduleSync(modId, kind, 0, remoteTs)
      cache = loadCache(modId)
    } catch (e) {
      if (e instanceof ChangelogUnavailableError) {
        unavailable = true
        cache = loadCache(modId)
      } else {
        syncFailed = true // breaker open / timeout / 429: degrade to cache
      }
    }
  }

  const neverFetched = cache.fetchedAt === 0 && cache.entries.length === 0
  const staleHead =
    remoteTs !== undefined &&
    remoteTs > cache.syncedThroughTs &&
    !negativeFresh(cache.negative, 'missing')
  if (neverFetched || staleHead) await runSync('head')

  if (unavailable || negativeFresh(cache.negative, 'unavailable')) {
    return {
      entries: [],
      hasMore: false,
      syncedThroughTs: cache.syncedThroughTs || null,
      status: 'unavailable',
      checkedAt: cache.negative?.checkedAt,
    }
  }

  const filter = (): StoredEntry[] =>
    q.beforeTs !== undefined ? cache.entries.filter(e => e.ts < q.beforeTs!) : cache.entries
  let filtered = filter()
  if (filtered.length < q.limit && !cache.complete && !syncFailed && cache.fetchedAt > 0) {
    await runSync('older')
    filtered = filter()
  }

  const page = filtered.slice(0, q.limit)
  const hasMore = filtered.length > q.limit || !cache.complete
  const status: ChangelogCursorPage['status'] =
    page.length === 0 && cache.fetchedAt === 0 && syncFailed ? 'error' : 'ok'
  return {
    entries: page.map(e => ({
      ts: e.ts,
      ord: e.ord,
      date: e.date,
      html: e.html,
      fetchedAt: e.fetchedAt,
    })),
    hasMore,
    syncedThroughTs: cache.syncedThroughTs || null,
    status,
  }
}

/**
 * Low-priority head prefetch (poller integration). Skips when the cache is
 * already synced through remoteTs, a negative record is fresh, the breaker is
 * open, or the prefetch queue is at its cap.
 */
export function prefetchChangelog(modId: string, remoteTs?: number): void {
  if (!/^\d+$/.test(modId) || breakerOpen()) return
  try {
    const cache = loadCache(modId)
    if (negativeFresh(cache.negative, 'unavailable')) return
    if (negativeFresh(cache.negative, 'missing')) return
    const stale =
      (remoteTs !== undefined && remoteTs > cache.syncedThroughTs) ||
      (cache.fetchedAt === 0 && cache.entries.length === 0)
    if (!stale) return
    scheduleSync(modId, 'head', 1, remoteTs).catch(() => undefined)
  } catch {
    // prefetch is strictly best-effort
  }
}
