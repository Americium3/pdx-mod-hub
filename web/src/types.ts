// Wire types for the amended API contract (docs/API_AMENDMENTS.md).
// All timestamps on the wire are unix-epoch seconds (fields named *Ts / *At / syncedAt).

/** Derived mod state (computed server-side, never stored as events). */
export type ModState =
  | 'awaiting-steam' // update-unseen-by-steam: remoteTs > latest ACF timeupdated (HOT)
  | 'queued-for-launch' // Steam noticed the update but defers download to game launch (calm)
  | 'downloading'
  | 'up-to-date'
  | 'not-installed' // account.subscribed && no ACF entry
  | 'orphaned' // installed && account fresh && unsubscribed
  | 'unverified' // account data stale — never a false orphaned claim
  | 'removed'
  | 'banned'
  | 'error'

export interface BranchRange {
  min: string
  max: string
}

export type ModSource = 'workshop' | 'local'

/** Slim per-mod summary in /api/state. Full detail lives at /api/mods/:id. */
export interface ModSummary {
  id: string
  appId: number
  title: string
  author?: string
  state: ModState
  remoteTs?: number
  acfTs?: number
  previewUrl?: string
  sizeWorkshop?: number
  sizeOnDisk?: number
  subs?: number
  source: ModSource
  branchRange?: BranchRange | null
  /** account.asOf — drives the "UNSUBSCRIBED · as of hh:mm" stamp */
  accountAsOf?: number
  dominantColor?: string
  timeCreated?: number
}

/** Full record from GET /api/mods/:id (fetched on expand/detail). */
export interface ModDetail extends ModSummary {
  descriptionHtml?: string
  tags?: string[]
  timeCreated?: number
  favorites?: number
  views?: number
  votesUp?: number
  votesDown?: number
  /** Steam star score 0..1 and vote count ("Not enough ratings" under ~10) */
  score?: number
  voteCount?: number
  /** resolved persona display name (author still carries the raw SteamID64 fallback) */
  authorName?: string
  authorAvatarUrl?: string
  authorUrl?: string
  /** required items (children) ids */
  children?: string[]
  /** required-by, computed across the local cache */
  requiredBy?: string[]
  dlcRequired?: { appId: number; name?: string }[]
}

export interface GameInfo {
  appId: number
  name: string
  short?: string
  installed: boolean
  hasWorkshopAcf?: boolean
  browsable?: boolean
  libraryPath?: string
  warnings?: string[]
  syncedAt?: number
  libraryOffline?: boolean
  modCount?: number
}

export interface LastPoll {
  at: number
  status: 'ok' | 'failed' | 'never'
  error?: string
}

export interface Settings {
  pollIntervalSec: number
  language: 'en' | 'zh'
  changelogPrefetch: boolean
  changelogPrefetchCap?: number
  dataFolder?: string
  imageCacheBytes?: number
  port?: number
  steamRootOverride?: string
  /** Optional ISteamUser key: switches persona resolution to batched GetPlayerSummaries. */
  steamWebApiKey?: string
}

export interface LibraryInfo {
  path: string
  reachable: boolean
}

/** GET /api/state — slim summaries only. */
export interface HubState {
  mods: ModSummary[]
  games: GameInfo[]
  lastPoll: LastPoll
  steamRunning: boolean
  helperActive: boolean
  seq: number
  etag?: string
  settings?: Settings
  /* diagnostics (Settings page) */
  steamRoot?: string | null
  libraries?: LibraryInfo[]
  polling?: boolean
}

/* ---------- Feed ---------- */

export type FeedEventType = 'update' | 'downloaded' | 'mod_removed' | 'mod_banned'

export interface FeedEvent {
  seq: number
  modId: string
  appId: number
  type: FeedEventType
  /** time_updated — the sort key */
  ts: number
  detectedAt: number
  /** snapshotted at event creation so feed history survives removal */
  title: string
  previewUrl?: string
  sizeDelta?: number
}

/** GET /api/feed?before_seq=&after_seq=&limit=50 */
export interface FeedPage {
  events: FeedEvent[]
  hasMore: boolean
}

/* ---------- Changelog ---------- */

export interface ChangelogEntry {
  ts: number
  ord: number
  html: string
  /** pre-rendered date string from the fetch pass (informational) */
  date?: string
  fetchedAt?: number
}

/** GET /api/mods/:id/changelog?before_ts=&limit=20 */
export interface ChangelogPage {
  entries: ChangelogEntry[]
  hasMore: boolean
  syncedThroughTs?: number | null
  /** 'unavailable' = negative-cached error page; 'error' = transient fetch
   *  failure with nothing cached — both degrade, never stall */
  status?: 'ok' | 'unavailable' | 'error'
  checkedAt?: number
}

/* ---------- Actions (202 + actionId + SSE stages) ---------- */

export type ActionKind = 'subscribe' | 'unsubscribe' | 'download' | 'force' | 'sync' | 'syncAll'

export type ActionStage =
  | 'queued'
  | 'helper_starting'
  | 'subscribed'
  | 'downloading'
  | 'result'
  | 'acf_confirmed'
  | 'result_ok_unconfirmed'
  | 'failed'

export const TERMINAL_STAGES: readonly ActionStage[] = [
  'acf_confirmed',
  'result_ok_unconfirmed',
  'failed',
]

export interface ActionProgress {
  actionId: string
  kind: ActionKind
  stage: ActionStage
  appId?: number
  modId?: string
  modIds?: string[]
  detail?: string
  queuePosition?: number
  startedAt: number
  endedAt?: number
}

export interface ActionAccepted {
  actionId: string
}

/* ---------- Browse ---------- */

export type BrowseSort =
  | 'relevance' // requires q (RankedByTextSearch)
  | 'updated'
  | 'published'
  | 'trend7d'
  | 'trend30d'
  | 'popular'

export interface BrowseItem {
  id: string
  title: string
  previewUrl?: string
  timeCreated?: number
  timeUpdated?: number
  subs?: number
  score?: number
  voteCount?: number
  tags?: string[]
  banned?: boolean
  /** cross-referenced server-side against account set + ACF */
  subscribed?: boolean
  installed?: boolean
  children?: string[]
  /** raw SteamID64 of the mod author (always present when Steam provides it) */
  ownerId?: string
  /** persona name/avatar — present only once the server-side cache resolves */
  author?: string
  authorAvatarUrl?: string
}

/** GET /api/personas?ids= — cached entries only; misses resolve in background. */
export interface PersonasResponse {
  personas: Record<string, { name: string; avatarUrl?: string }>
  pending: number
}

/** POST /api/browse/:appId {q, sort, page} */
export interface BrowsePage {
  items: BrowseItem[]
  page: number
  perPage: number
  total?: number
  capped: boolean
}

/* ---------- SSE poke channel ---------- */

export type SsePoke =
  | { type: 'state'; seq: number }
  | { type: 'feed'; seq: number }
  | {
      type: 'action'
      seq: number
      actionId: string
      stage: ActionStage
      kind?: ActionKind
      appId?: number
      modId?: string
      detail?: string
      queuePosition?: number
    }
