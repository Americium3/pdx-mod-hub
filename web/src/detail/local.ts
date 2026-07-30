// Local bilingual fallbacks for i18n keys that do not exist in the shared dict
// (web/src/i18n.ts is owned by the shell/integrator). Every key here is also
// reported in the agent's missingI18nKeys list so it can be centralized later.
import { useCallback } from 'react'
import type { Lang } from '../i18n'
import { useHub } from '../store'

const LOCAL = {
  'detail.tab.description': { en: 'Description', zh: '描述' },
  'detail.removedBanner': {
    en: 'This mod has been removed from the Workshop. Cached data is shown.',
    zh: '该模组已从创意工坊移除，以下为缓存数据。',
  },
  'detail.bannedBanner': {
    en: 'This mod has been banned by Steam and is no longer available.',
    zh: '该模组已被 Steam 封禁，创意工坊不再提供。',
  },
  'detail.loadFailed': { en: 'Failed to load details: {e}', zh: '详情加载失败：{e}' },
  'detail.noDescription': { en: 'No description provided.', zh: '暂无描述。' },
  'detail.modId': { en: 'Workshop ID', zh: '工坊 ID' },
} as const

export type LocalKey = keyof typeof LOCAL

export function localT(
  lang: Lang,
  key: LocalKey,
  vars?: Record<string, string | number>,
): string {
  let s: string = LOCAL[key][lang]
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
  }
  return s
}

/** Hook mirroring useHub().t for the local fallback dictionary. */
export function useLocalT(): (key: LocalKey, vars?: Record<string, string | number>) => string {
  const { lang } = useHub()
  return useCallback((key, vars) => localT(lang, key, vars), [lang])
}
