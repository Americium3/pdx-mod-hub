export interface GameInfo {
  appId: number
  name: string
  short: string
  workshop: boolean
  installed: boolean
  installDir?: string
  libraryPath?: string
  workshopAcf?: string
  modCount: number
  updatesPending: number
  owned?: boolean
  syncedAt?: number
}

export type ModStatus =
  | 'update-available'
  | 'up-to-date'
  | 'not-installed'
  | 'orphaned'
  | 'removed'
  | 'unknown'

export interface ModView {
  id: string
  appId: number
  title: string
  previewUrl?: string
  tags: string[]
  fileSize?: number
  sizeOnDisk?: number
  timeCreated?: number
  timeUpdatedRemote?: number
  timeUpdatedLocal?: number
  subscriptions?: number
  lifetimeSubscriptions?: number
  favorited?: number
  views?: number
  creator?: string
  banned?: boolean
  subscribed?: boolean
  status: ModStatus
}

export interface UpdateEvent {
  key: string
  modId: string
  appId: number
  ts: number
  detectedAt: number
  downloadedAt?: number
  title?: string
}

export interface ChangelogEntry {
  ts: number
  date: string
  html: string
}

export interface ChangelogPage {
  entries: ChangelogEntry[]
  hasMore: boolean
}

export interface Settings {
  port: number
  pollIntervalMin: number
  changelogPrefetch: boolean
  language: 'en' | 'zh'
  steamRootOverride?: string
}

export interface HubState {
  settings: Settings
  steamRoot: string | null
  steamRunning: boolean
  libraries: string[]
  lastPoll: number
  lastPollError?: string
  polling: boolean
  games: GameInfo[]
  mods: ModView[]
  feed: UpdateEvent[]
}

export interface BrowseItem {
  id: string
  title: string
  description: string
  previewUrl: string | null
  timeCreated: number
  timeUpdated: number
  tags: string[]
  numUpvotes: number
  numDownvotes: number
  subscriptions: string | null
  banned: boolean
  url: string
}

export interface BrowseResult {
  ok: boolean
  error?: string
  appId: number
  page: number
  total: number
  items: BrowseItem[]
}
