// API client for the amended wire contract (docs/API_AMENDMENTS.md).
// Every /api request carries the custom `X-PMH: 1` header (CSRF preflight forcer);
// the only exceptions server-side are /api/img and the SSE stream.
import type {
  ActionAccepted,
  ActionKind,
  ActionProgress,
  BrowsePage,
  BrowseSort,
  ChangelogPage,
  FeedPage,
  HubState,
  ModDetail,
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

export interface FeedQuery {
  beforeSeq?: number
  afterSeq?: number
  limit?: number
}

export const api = {
  ping: (): Promise<{ app: string }> => get('/api/ping'),

  /** Slim state: summaries + games + lastPoll + steamRunning + helperActive + seq. */
  state: (): Promise<HubState> => get('/api/state'),

  /** Full mod record — fetched on expand/detail only. */
  mod: (modId: string): Promise<ModDetail> => get(`/api/mods/${encodeURIComponent(modId)}`),

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
    return get(`/api/feed?${q.toString()}`)
  },

  /** All actions are async jobs: 202 {actionId}; progress arrives over SSE. */
  action: (
    kind: Extract<ActionKind, 'subscribe' | 'unsubscribe' | 'download'>,
    payload: { appId: number; modId?: string; modIds?: string[] },
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
  ): Promise<BrowsePage> => send('POST', `/api/browse/${appId}`, body),

  /** PATCH semantics; response echoes the applied settings. */
  patchSettings: (patch: Partial<Settings>): Promise<Settings> =>
    send('PATCH', '/api/settings', patch),

  clearImageCache: (): Promise<{ ok: boolean }> => send('POST', '/api/img/clear'),
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
