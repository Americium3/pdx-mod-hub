import path from 'node:path'
import { DATA_DIR } from './config.js'
import { readJson, writeJson } from './store.js'
import type { FeedEvent, FeedEventType } from './types.js'

// Feed event engine: monotonic persisted seq, dedupe on (modId, type, ts),
// retention = max(newest 500, last 90 days), compact on startup.

const EVENTS_FILE = path.join(DATA_DIR, 'events.json')
const MIN_KEEP = 500
const MAX_AGE_SEC = 90 * 86_400

export interface NewFeedEvent {
  modId: string
  appId: number
  type: FeedEventType
  ts: number
  detectedAt: number
  title?: string
  previewUrl?: string
}

interface EventsFileV2 {
  version: 2
  seq: number
  events: FeedEvent[]
}

interface LegacyEvent {
  key?: string
  modId?: string
  appId?: number
  ts?: number
  detectedAt?: number
  downloadedAt?: number
  title?: string
}

let seqCounter = 0
let events: FeedEvent[] = [] // ascending by seq
const seen = new Set<string>()

const dedupeKey = (modId: string, type: FeedEventType, ts: number): string =>
  `${modId}:${type}:${ts}`

export function currentSeq(): number {
  return seqCounter
}

function pushEvent(ev: NewFeedEvent): FeedEvent | null {
  const key = dedupeKey(ev.modId, ev.type, ev.ts)
  if (seen.has(key)) return null
  seen.add(key)
  const full: FeedEvent = { seq: ++seqCounter, ...ev }
  events.push(full)
  return full
}

function compact(): boolean {
  if (events.length <= MIN_KEEP) return false
  const cutoff = Math.floor(Date.now() / 1000) - MAX_AGE_SEC
  const keepFrom = events.length - MIN_KEEP
  const kept = events.filter((e, i) => i >= keepFrom || e.detectedAt >= cutoff)
  if (kept.length === events.length) return false
  events = kept
  seen.clear()
  for (const e of events) seen.add(dedupeKey(e.modId, e.type, e.ts))
  return true
}

function persist(): Promise<void> {
  const data: EventsFileV2 = { version: 2, seq: seqCounter, events }
  return writeJson(EVENTS_FILE, data)
}

/**
 * Load + migrate + compact. The pre-contract schema (a bare array keyed by
 * `${modId}:${ts}`) is migrated in place: each entry becomes an 'updated' event
 * (plus a 'downloaded' event when it carried downloadedAt), with seqs assigned
 * in detection order. Snapshots for migrated events come from `snapshotOf`.
 */
export function initEvents(
  snapshotOf: (modId: string) => { title?: string; previewUrl?: string } | undefined,
): void {
  seqCounter = 0
  events = []
  seen.clear()
  const raw = readJson<unknown>(EVENTS_FILE, null)
  if (Array.isArray(raw)) {
    const staged: NewFeedEvent[] = []
    for (const ev of raw as LegacyEvent[]) {
      if (!ev || typeof ev.modId !== 'string' || typeof ev.ts !== 'number') continue
      const snap = snapshotOf(ev.modId)
      const base = {
        modId: ev.modId,
        appId: ev.appId ?? 0,
        ts: ev.ts,
        title: ev.title ?? snap?.title,
        previewUrl: snap?.previewUrl,
      }
      staged.push({ ...base, type: 'updated', detectedAt: ev.detectedAt ?? ev.ts })
      if (typeof ev.downloadedAt === 'number') {
        staged.push({ ...base, type: 'downloaded', detectedAt: ev.downloadedAt })
      }
    }
    staged.sort((a, b) => a.detectedAt - b.detectedAt || a.ts - b.ts)
    for (const ev of staged) pushEvent(ev)
    compact()
    void persist()
    console.log(`[events] migrated ${events.length} legacy events (seq=${seqCounter})`)
    return
  }
  const file = raw as EventsFileV2 | null
  if (!file || file.version !== 2 || !Array.isArray(file.events)) return
  const sorted = file.events
    .filter(e => e && typeof e.seq === 'number' && typeof e.modId === 'string')
    .sort((a, b) => a.seq - b.seq)
  let dropped = 0
  for (const ev of sorted) {
    const key = dedupeKey(ev.modId, ev.type, ev.ts)
    if (seen.has(key)) {
      dropped++
      continue
    }
    seen.add(key)
    events.push(ev)
  }
  seqCounter = Math.max(
    typeof file.seq === 'number' ? file.seq : 0,
    events.length > 0 ? events[events.length - 1].seq : 0,
  )
  const compacted = compact()
  if (dropped > 0 || compacted || sorted.length !== file.events.length) void persist()
}

/** Append events (deduped); persists and returns the ones actually added. */
export function addEvents(list: NewFeedEvent[]): FeedEvent[] {
  const added: FeedEvent[] = []
  for (const ev of list) {
    const full = pushEvent(ev)
    if (full) added.push(full)
  }
  if (added.length > 0) {
    compact()
    void persist()
  }
  return added
}

export interface FeedQuery {
  beforeSeq?: number
  afterSeq?: number
  limit: number
}

export interface FeedPage {
  events: FeedEvent[]
  hasMore: boolean
  seq: number
}

/** Cursor feed: newest-first, stable under head insertion (seq cursors, not offsets). */
export function queryFeed(q: FeedQuery): FeedPage {
  const { beforeSeq, afterSeq, limit } = q
  let pool = events
  if (afterSeq !== undefined) pool = pool.filter(e => e.seq > afterSeq)
  if (beforeSeq !== undefined) pool = pool.filter(e => e.seq < beforeSeq)
  const newestFirst = [...pool].reverse()
  return {
    events: newestFirst.slice(0, limit),
    hasMore: newestFirst.length > limit,
    seq: seqCounter,
  }
}
