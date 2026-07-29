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

export interface LocalMod {
  id: string
  appId: number
  sizeBytes: number
  timeUpdated: number
  manifest?: string
  latestTimeUpdated?: number
}

export interface RemoteMod {
  id: string
  result: number
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

export interface SubsCache {
  appId: number
  syncedAt: number
  ids: string[]
  states: Record<string, number>
}
