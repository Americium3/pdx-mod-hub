// API client for the amended wire contract (docs/API_AMENDMENTS.md).
// Every /api request carries the custom `X-PMH: 1` header (CSRF preflight forcer);
// the only exceptions server-side are /api/img and the SSE stream.
//
// The SERVER wire format is the source of truth. This module is the single
// place where server spellings are translated into the client view model
// (web/src/types.ts): mod-state names, fileSize -> sizeWorkshop, feed event
// types, sanitized description -> descriptionHtml, browse vote counts, etc.
import type {
  ActionAccepted,
  ActionKind,
  ActionProgress,
  BranchRange,
  BrowseItem,
  BrowsePage,
  BrowseSort,
  ChangelogPage,
  FeedEvent,
  FeedEventType,
  FeedPage,
  HubState,
  ModDetail,
  ModState,
  Settings,
  SsePoke,
} from './types'

export class ApiError extends Error {
  status: number
  code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    let code: string | undefined
    try {
      const body = (await res.json()) as { error?: string; message?: string }
      if (body.error) {
        code = body.error
        msg = body.message ?? body.error
      }
    } catch {
      // keep HTTP status message
    }
    throw new ApiError(res.status, msg, code)
  }
  return res.json() as Promise<T>
}

function get<T>(path: string): Promise<T> {
  return fetch(path, { headers: { 'X-PMH': '1' } }).then(r => parse<T>(r))
}

function send<T>(method: 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  return fetch(path, {
    method,
    headers:
      body === undefined
        ? { 'X-PMH': '1' }
        : { 'X-PMH': '1', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(r => parse<T>(r))
}

/* ---------- server wire -> client view-model normalization ---------- */

type Raw = Record<string, unknown>

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

/** Server ModState spellings (server/src/types.ts) -> client view states. */
const STATE_MAP: Record<string, ModState> = {
  'update-unseen': 'awaiting-steam',
  'update-pending-launch': 'queued-for-launch',
  'up-to-date': 'up-to-date',
  'not-installed': 'not-installed',
  orphaned: 'orphaned',
  unverified: 'unverified',
  removed: 'removed',
  banned: 'banned',
  unknown: 'error',
  // pass-through in case the server ever adopts the client spellings
  'awaiting-steam': 'awaiting-steam',
  'queued-for-launch': 'queued-for-launch',
  downloading: 'downloading',
  error: 'error',
}

function mapState(v: unknown): ModState {
  return STATE_MAP[String(v)] ?? 'error'
}

function mapBranchRange(v: unknown): BranchRange | undefined {
  if (v && typeof v === 'object') {
    const r = v as Raw
    const min = str(r.min)
    const max = str(r.max)
    if (min !== undefined && max !== undefined) return { min, max }
  }
  return undefined
}

function mapSummary(raw: Raw): HubState['mods'][number] {
  return {
    id: String(raw.id ?? ''),
    appId: num(raw.appId) ?? 0,
    title: str(raw.title) ?? String(raw.id ?? ''),
    author: str(raw.author) ?? str(raw.creator),
    state: mapState(raw.state),
    remoteTs: num(raw.remoteTs),
    acfTs: num(raw.acfTs),
    previewUrl: str(raw.previewUrl),
    sizeWorkshop: num(raw.sizeWorkshop) ?? num(raw.fileSize),
    sizeOnDisk: num(raw.sizeOnDisk),
    subs: num(raw.subs),
    source: raw.source === 'local' ? 'local' : 'workshop',
    branchRange: mapBranchRange(raw.branchRange),
    accountAsOf: num(raw.accountAsOf),
    dominantColor: str(raw.dominantColor),
  }
}

function mapHubState(raw: Raw): HubState {
  const mods = Array.isArray(raw.mods) ? (raw.mods as Raw[]).map(mapSummary) : []
  const lp = (raw.lastPoll ?? {}) as Raw
  return {
    mods,
    games: Array.isArray(raw.games) ? (raw.games as HubState['games']) : [],
    lastPoll: {
      at: num(lp.at) ?? 0,
      status: lp.status === 'ok' || lp.status === 'failed' ? lp.status : 'never',
      error: str(lp.error),
    },
    steamRunning: raw.steamRunning === true,
    helperActive: raw.helperActive === true,
    seq: num(raw.seq) ?? 0,
    etag: str(raw.etag),
    settings: (raw.settings ?? undefined) as Settings | undefined,
    steamRoot: str(raw.steamRoot) ?? null,
    libraries: Array.isArray(raw.libraries)
      ? (raw.libraries as { path: string; reachable: boolean }[])
      : undefined,
    polling: raw.polling === true ? true : undefined,
  }
}

function idList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(x => String(x)).filter(x => /^\d+$/.test(x)) : []
}

function mapDetail(raw: Raw): ModDetail {
  const account = (raw.account ?? null) as { subscribed?: boolean; asOf?: number } | null
  const deps = (raw.dependencies ?? {}) as Raw
  const votesUp = num(raw.votesUp) ?? num(raw.numUpvotes)
  const votesDown = num(raw.votesDown) ?? num(raw.numDownvotes)
  const voteCount =
    num(raw.voteCount) ??
    (votesUp !== undefined && votesDown !== undefined ? votesUp + votesDown : undefined)
  const score =
    num(raw.score) ??
    (voteCount !== undefined && voteCount > 0 && votesUp !== undefined
      ? votesUp / voteCount
      : undefined)
  return {
    ...mapSummary(raw),
    accountAsOf: num(raw.accountAsOf) ?? num(account?.asOf),
    // Server `description` is SANITIZED HTML (BBCode whitelist + DOMPurify,
    // must-fix 5) — surface it under the innerHTML-safe field name only.
    descriptionHtml: str(raw.descriptionHtml) ?? str(raw.description),
    tags: Array.isArray(raw.tags) ? (raw.tags as unknown[]).map(x => String(x)) : [],
    timeCreated: num(raw.timeCreated) ?? num(raw.timeCreatedTs),
    favorites: num(raw.favorites) ?? num(raw.favorited),
    views: num(raw.views),
    votesUp,
    votesDown,
    score,
    voteCount,
    authorAvatarUrl: str(raw.authorAvatarUrl),
    authorUrl: str(raw.authorUrl),
    children: idList(raw.children).length > 0 ? idList(raw.children) : idList(deps.requires),
    requiredBy:
      idList(raw.requiredBy).length > 0 ? idList(raw.requiredBy) : idList(deps.requiredBy),
    dlcRequired: Array.isArray(raw.dlcRequired)
      ? (raw.dlcRequired as { appId: number; name?: string }[]).filter(
          d => d && typeof d.appId === 'number',
        )
      : [],
  }
}

/** Server FeedEventType spellings (updated/removed/banned) -> client names. */
const FEED_TYPE_MAP: Record<string, FeedEventType> = {
  updated: 'update',
  update: 'update',
  downloaded: 'downloaded',
  removed: 'mod_removed',
  mod_removed: 'mod_removed',
  banned: 'mod_banned',
  mod_banned: 'mod_banned',
}

function mapFeed(raw: Raw): FeedPage {
  const events: FeedEvent[] = (Array.isArray(raw.events) ? (raw.events as Raw[]) : []).map(e => ({
    seq: num(e.seq) ?? 0,
    modId: String(e.modId ?? ''),
    appId: num(e.appId) ?? 0,
    type: FEED_TYPE_MAP[String(e.type)] ?? 'update',
    ts: num(e.ts) ?? 0,
    detectedAt: num(e.detectedAt) ?? num(e.ts) ?? 0,
    title: str(e.title) ?? String(e.modId ?? ''),
    previewUrl: str(e.previewUrl),
    sizeDelta: num(e.sizeDelta),
  }))
  return { events, hasMore: raw.hasMore === true }
}

/** Helper browse items carry numUpvotes/numDownvotes and a string subs count. */
function mapBrowseItem(raw: Raw): BrowseItem {
  const up = num(raw.numUpvotes)
  const down = num(raw.numDownvotes)
  const voteCount =
    num(raw.voteCount) ?? (up !== undefined && down !== undefined ? up + down : undefined)
  const score =
    num(raw.score) ??
    (voteCount !== undefined && voteCount > 0 && up !== undefined ? up / voteCount : undefined)
  const subsRaw = raw.subs ?? raw.subscriptions
  const subs =
    num(subsRaw) ??
    (typeof subsRaw === 'string' && /^\d+$/.test(subsRaw) ? Number(subsRaw) : undefined)
  return {
    id: String(raw.id ?? ''),
    title: str(raw.title) ?? String(raw.id ?? ''),
    author: str(raw.author),
    authorAvatarUrl: str(raw.authorAvatarUrl),
    previewUrl: str(raw.previewUrl),
    timeCreated: num(raw.timeCreated),
    timeUpdated: num(raw.timeUpdated),
    subs,
    sizeWorkshop: num(raw.sizeWorkshop) ?? num(raw.fileSize),
    score,
    voteCount,
    tags: Array.isArray(raw.tags) ? (raw.tags as unknown[]).map(x => String(x)) : undefined,
    banned: raw.banned === true,
    subscribed: raw.subscribed === true,
    installed: raw.installed === true,
    children: idList(raw.children),
  }
}

export interface FeedQuery {
  beforeSeq?: number
  afterSeq?: number
  limit?: number
}

export const api = {
  ping: (): Promise<{ app: string }> => get('/api/ping'),

  /** Slim state: summaries + games + lastPoll + steamRunning + helperActive + seq. */
  state: (): Promise<HubState> => get<Raw>('/api/state').then(mapHubState),

  /** Full mod record — fetched on expand/detail only. */
  mod: (modId: string): Promise<ModDetail> =>
    get<Raw>(`/api/mods/${encodeURIComponent(modId)}`).then(mapDetail),

  /** Cursor-paginated changelog (before_ts, never ?page=). */
  changelog: (modId: string, beforeTs?: number, limit = 20): Promise<ChangelogPage> => {
    const q = new URLSearchParams()
    if (beforeTs !== undefined) q.set('before_ts', String(beforeTs))
    q.set('limit', String(limit))
    return get(`/api/mods/${encodeURIComponent(modId)}/changelog?${q.toString()}`)
  },

  /** Feed cursors: before_seq scroll-back, after_seq catch-up (stable under head insertion). */
  feed: (query: FeedQuery = {}): Promise<FeedPage> => {
    const q = new URLSearchParams()
    if (query.beforeSeq !== undefined) q.set('before_seq', String(query.beforeSeq))
    if (query.afterSeq !== undefined) q.set('after_seq', String(query.afterSeq))
    q.set('limit', String(query.limit ?? 50))
    return get<Raw>(`/api/feed?${q.toString()}`).then(mapFeed)
  },

  /**
   * All actions are async jobs: 202 {actionId}; progress arrives over SSE.
   * The server takes ONE modId per job (POST /api/actions/:action {appId, modId});
   * bulk selections fan out in the store, one job per mod.
   */
  action: (
    kind: Extract<ActionKind, 'subscribe' | 'unsubscribe' | 'download' | 'force'>,
    payload: { appId: number; modId: string },
  ): Promise<ActionAccepted> => send('POST', `/api/actions/${kind}`, payload),

  /** Reconnect catch-up for an in-flight action. */
  actionStatus: (actionId: string): Promise<ActionProgress> =>
    get(`/api/actions/${encodeURIComponent(actionId)}`),

  /** Sync one game's subscriptions (helper launch) — 202 {actionId}. */
  sync: (appId: number): Promise<ActionAccepted> => send('POST', `/api/sync/${appId}`),

  /** Sync every game sequentially through the single helper queue. */
  syncAll: (): Promise<ActionAccepted> => send('POST', '/api/sync'),

  /** Manual poll trigger for the ops-bar refresh / "Check now". */
  checkNow: (): Promise<{ ok: boolean }> => send('POST', '/api/poll'),

  /** POST — a helper-spawning endpoint must never be a cacheable GET. */
  browse: (
    appId: number,
    body: { q?: string; sort: BrowseSort; page: number },
  ): Promise<BrowsePage> =>
    send<Raw>('POST', `/api/browse/${appId}`, body).then(raw => ({
      items: (Array.isArray(raw.items) ? (raw.items as Raw[]) : []).map(mapBrowseItem),
      page: num(raw.page) ?? body.page,
      perPage: num(raw.perPage) ?? 50,
      total: num(raw.total),
      capped: raw.capped === true,
    })),

  /** PATCH semantics; response echoes the applied settings. */
  patchSettings: (patch: Partial<Settings>): Promise<Settings> =>
    send('PATCH', '/api/settings', patch),

  /** GET /api/imgcache — proxy cache stats for the Settings readout. */
  imageCacheStats: (): Promise<{ files: number; bytes: number; maxBytes: number }> =>
    get('/api/imgcache'),

  /** POST /api/imgcache clears the proxy cache (returns fresh stats). */
  clearImageCache: (): Promise<{ ok: boolean }> => send('POST', '/api/imgcache'),
}

/** Route any Steam art through the local proxy (SSRF-hardened, cached). */
export function img(url: string | undefined | null): string | undefined {
  if (!url) return undefined
  return `/api/img?u=${encodeURIComponent(url)}`
}

/* ---------- SSE poke channel ---------- */

export interface SseHandlers {
  /** Any poke ({type: state|feed|action, seq}). */
  onPoke: (poke: SsePoke) => void
  /** Fired on every open (incl. reconnects) — client must refetch state + feed?after_seq. */
  onOpen?: () => void
  onDown?: () => void
}

/**
 * Connect the poke channel. The server sets `id:` to the monotonic seq, so the
 * browser resends Last-Event-ID automatically on reconnect; regardless, the
 * contract is refetch-on-open (state + feed catch-up), handled by the caller.
 */
export function connectEvents(handlers: SseHandlers): () => void {
  const es = new EventSource('/api/events')
  es.onmessage = e => {
    try {
      const poke = JSON.parse(e.data as string) as SsePoke
      if (poke && typeof poke === 'object' && 'type' in poke) handlers.onPoke(poke)
    } catch {
      // ignore malformed payloads / heartbeat noise
    }
  }
  es.onopen = () => handlers.onOpen?.()
  es.onerror = () => handlers.onDown?.()
  return () => es.close()
}
