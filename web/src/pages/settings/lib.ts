// Settings-page local helpers: bilingual fallback strings for i18n keys that do
// not exist in the shared dict yet (listed in missingI18nKeys for the
// integrator), plus thin fetchers for endpoints the shared api client does not
// cover (per-field 422 capture, GET /api/imgcache, POST /api/probe-owned,
// POST /api/open-folder). All requests carry the X-PMH CSRF header.
import { useCallback } from 'react'
import { ApiError } from '../../api'
import type { Lang } from '../../i18n'
import { useHub } from '../../store'
import type { Settings } from '../../types'

/* ---------- Local bilingual fallbacks (temporary, integrator centralizes) ---------- */

const LOCAL_DICT = {
  'settings.interface': { en: 'Interface', zh: '界面' },
  'settings.storage': { en: 'Storage', zh: '存储' },
  'settings.steamRoot': { en: 'Steam root', zh: 'Steam 根目录' },
  'settings.helperActive': { en: 'active', zh: '工作中' },
  'settings.helperIdle': { en: 'idle', zh: '空闲' },
  'settings.colGame': { en: 'Game', zh: '游戏' },
  'settings.colSynced': { en: 'Last sync', zh: '上次同步' },
  'settings.syncAllHint': {
    en: 'Games sync sequentially through one helper queue (brief in-game flash each).',
    zh: '各游戏经单一助手队列依次同步（每个会短暂显示游戏中）。',
  },
  'settings.probeOwned': { en: 'Probe owned games', zh: '探测已拥有的游戏' },
  'settings.probeRun': { en: 'Probe', zh: '探测' },
  'settings.probeOwnedHint': {
    en: 'List Paradox games you own but have not installed (starts the Steam helper).',
    zh: '列出已拥有但未安装的P社游戏（将启动 Steam 助手）。',
  },
  'settings.ownedNotInstalled': { en: 'Owned, not installed', zh: '已拥有，未安装' },
  'settings.probeNone': {
    en: 'Every owned Paradox game is installed.',
    zh: '已拥有的P社游戏均已安装。',
  },
  'settings.dataFolderHint': {
    en: 'Mod state, events and caches live here. Changing it ships in a later version.',
    zh: '模组状态、事件与缓存存放于此。更改目录将在后续版本提供。',
  },
  'settings.imageCacheHint': {
    en: 'Proxied Steam art cached on disk.',
    zh: '缓存在本地磁盘的 Steam 图片。',
  },
  'settings.cacheCleared': { en: 'Image cache cleared', zh: '图片缓存已清空' },
  'settings.warnings': { en: 'Warnings', zh: '警告' },
} as const

export type LocalKey = keyof typeof LOCAL_DICT

export function localPair(key: LocalKey): { en: string; zh: string } {
  return LOCAL_DICT[key]
}

/** t-like helper over the page-local fallback dict (same Lang as the store). */
export function useLocalT(): (key: LocalKey) => string {
  const { lang } = useHub()
  return useCallback((key: LocalKey) => LOCAL_DICT[key][lang as Lang], [lang])
}

/* ---------- Local fetchers ---------- */

const PMH_HEADER = { 'X-PMH': '1' }

/** PATCH /api/settings rejection with the per-field error map preserved. */
export class SettingsValidationError extends Error {
  fields: Record<string, string>

  constructor(fields: Record<string, string>) {
    super('invalid settings')
    this.fields = fields
  }
}

async function readBody(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

function toApiError(res: Response, body: Record<string, unknown> | null): ApiError {
  const code = typeof body?.error === 'string' ? body.error : undefined
  const message =
    typeof body?.message === 'string' ? body.message : (code ?? `HTTP ${res.status}`)
  return new ApiError(res.status, message, code)
}

/**
 * PATCH /api/settings keeping per-field 422 errors (the shared client folds the
 * `errors` map away). Throws SettingsValidationError on 422, ApiError otherwise.
 */
export async function patchSettingsDetailed(patch: Partial<Settings>): Promise<void> {
  const res = await fetch('/api/settings', {
    method: 'PATCH',
    headers: { ...PMH_HEADER, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (res.ok) return
  const body = await readBody(res)
  const errors = body?.errors
  if (res.status === 422 && errors && typeof errors === 'object' && !Array.isArray(errors)) {
    const fields: Record<string, string> = {}
    for (const [k, v] of Object.entries(errors as Record<string, unknown>)) {
      fields[k] = typeof v === 'string' ? v : String(v)
    }
    throw new SettingsValidationError(fields)
  }
  throw toApiError(res, body)
}

export interface ImgCacheInfo {
  bytes: number | null
  files: number | null
}

/** GET /api/imgcache — size readout; tolerant of field-name variants. */
export async function fetchImgCache(): Promise<ImgCacheInfo> {
  const res = await fetch('/api/imgcache', { headers: PMH_HEADER })
  if (!res.ok) throw toApiError(res, await readBody(res))
  const body = (await readBody(res)) ?? {}
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  return {
    bytes: num(body.bytes) ?? num(body.sizeBytes) ?? num(body.size),
    files: num(body.files) ?? num(body.count) ?? num(body.entries),
  }
}

export interface ProbeOwnedEntry {
  owned: boolean
  installed: boolean
}

/** POST /api/probe-owned → owned/installed map keyed by appId string. */
export async function probeOwned(): Promise<Record<string, ProbeOwnedEntry>> {
  const res = await fetch('/api/probe-owned', { method: 'POST', headers: PMH_HEADER })
  const body = await readBody(res)
  if (!res.ok) throw toApiError(res, body)
  const raw = body?.owned
  const out: Record<string, ProbeOwnedEntry> = {}
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      if (v && typeof v === 'object') {
        const entry = v as Record<string, unknown>
        out[id] = { owned: entry.owned === true, installed: entry.installed === true }
      }
    }
  }
  return out
}

/** POST /api/open-folder — reveal the data folder in Explorer (display-only v1). */
export async function openFolder(path?: string): Promise<void> {
  const res = await fetch('/api/open-folder', {
    method: 'POST',
    headers: { ...PMH_HEADER, 'Content-Type': 'application/json' },
    body: JSON.stringify(path ? { path } : {}),
  })
  if (!res.ok) throw toApiError(res, await readBody(res))
}
