// Core data model per docs/API_AMENDMENTS.md (stage A).

export type ModSource = 'workshop' | 'local'

export type RemoteFetchStatus = 'ok' | 'removed' | 'banned' | 'private' | 'error'

export type ModState =
  | 'update-unseen' // hot: remoteTs > ACF latest_timeupdated (Steam has not noticed yet)
  | 'update-pending-launch' // calm: Steam noticed (latest_* advanced) but waits for game launch
  | 'up-to-date'
  | 'not-installed'
  | 'orphaned' // installed && fresh account data says not subscribed
  | 'unverified' // installed && stale account data says not subscribed
  | 'removed'
  | 'banned'
  | 'unknown'

export interface RemoteMeta {
  title?: string
  description?: string
  previewUrl?: string
  fileSize?: number
  timeCreated?: number
  subscriptions?: number
  lifetimeSubscriptions?: number
  favorited?: number
  views?: number
  tags?: string[]
  creator?: string
}

export interface RemoteInfo {
  fetchStatus: RemoteFetchStatus
  /** Last-known-good time_updated; survives removed/banned/private/error responses. */
  remoteTs?: number
  /** Epoch seconds of the last fetchStatus==='ok' response (0 = unknown/migrated). */
  lastOkAt?: number
  /** Last-known-good metadata; never overwritten by non-ok responses. */
  meta?: RemoteMeta
}

export interface AcfInfo {
  present: true
  /** Installed timeupdated from WorkshopItemsInstalled. */
  acfTs: number
  manifest?: string
  sizeOnDisk: number
}

export interface LatestAcf {
  latestTimeupdated?: number
  latestManifest?: string
}

export interface AccountInfo {
  subscribed: boolean
  /** Epoch seconds when this fact was learned (sync time or optimistic action time). */
  asOf: number
}

export interface BranchRange {
  min: string
  max: string
}

export interface ModRecord {
  id: string
  appId: number
  source: ModSource
  acf: AcfInfo | null
  latestAcf: LatestAcf | null
  remote: RemoteInfo | null
  /** Last remote time_updated this server has observed; event diffs run against this, never ACF. */
  lastSeenRemoteTs: number | null
  /** Runtime-only memo of the sanitized description HTML (keyed by raw source). */
  descCache?: { src: string; html: string }
}

/** Subset of ModRecord persisted to data/mods.json (ACF parts are re-derived on scan). */
export interface PersistedModRecord {
  appId: number
  source: ModSource
  remote: RemoteInfo | null
  lastSeenRemoteTs: number | null
}

export type FeedEventType = 'updated' | 'downloaded' | 'removed' | 'banned'

export interface FeedEvent {
  /** Monotonic, persisted across restarts; SSE id and feed cursor. */
  seq: number
  modId: string
  appId: number
  type: FeedEventType
  /** Sort key: remote/installed time_updated for updated/downloaded, detection time otherwise. */
  ts: number
  detectedAt: number
  /** Snapshotted at creation so feed history survives removal. */
  title?: string
  previewUrl?: string
  /** byte change vs the prior snapshot (updated: remote fileSize; downloaded: on-disk size) */
  sizeDelta?: number
}

export interface LastPoll {
  at: number
  status: 'ok' | 'failed' | 'never'
  error?: string
}

export interface LibraryInfo {
  path: string
  reachable: boolean
}

export interface GameInfo {
  appId: number
  name: string
  short: string
  workshop: boolean
  browsable: boolean
  installed: boolean
  hasWorkshopAcf: boolean
  installDir?: string
  libraryPath?: string
  workshopAcf?: string
  libraryOffline: boolean
  warnings: string[]
  modCount: number
  updatesPending: number
  owned?: boolean
  syncedAt?: number
}

/** Slim per-mod summary served by GET /api/state; full detail lives at GET /api/mods/:id. */
export interface ModSummary {
  id: string
  appId: number
  title: string
  state: ModState
  remoteTs: number | null
  acfTs: number | null
  previewUrl?: string
  sizeOnDisk?: number
  fileSize?: number
  subs?: number
  /** publishedfiledetails creator steamId64 -> client `author` fallback */
  creator?: string
  branchRange: BranchRange | null
  source: ModSource
  timeCreatedTs?: number | null
  /** account.asOf — drives the "UNSUBSCRIBED · as of hh:mm" stamp client-side */
  accountAsOf?: number | null
}

export interface StatePayload {
  seq: number
  settings: Settings
  steamRoot: string | null
  libraries: LibraryInfo[]
  steamRunning: boolean
  helperActive: boolean
  polling: boolean
  lastPoll: LastPoll
  games: GameInfo[]
  mods: ModSummary[]
}

/** One item parsed out of an appworkshop_<appId>.acf. */
export interface AcfModEntry {
  id: string
  appId: number
  sizeOnDisk: number
  /** WorkshopItemsInstalled.timeupdated (0 = not yet downloaded). */
  installedTs: number
  manifest?: string
  /** WorkshopItemDetails.timeupdated (what Steam last synced). */
  detailTs: number
  latestTimeupdated?: number
  latestManifest?: string
}

export interface Settings {
  port: number
  pollIntervalSec: number
  changelogPrefetch: boolean
  language: 'en' | 'zh'
  steamRootOverride?: string
}

export interface SubsCache {
  appId: number
  syncedAt: number
  ids: string[]
  states: Record<string, number>
}

// Changelog wire/cache types live in changelog.ts (stage B cursor model).
