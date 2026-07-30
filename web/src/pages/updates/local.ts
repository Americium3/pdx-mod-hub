// Temporary bilingual fallbacks for i18n keys that do not exist yet in the
// shared dict (web/src/i18n.ts is owned by the integrator). Listed in the
// structured output's missingI18nKeys so they can be centralized later.
import { useCallback } from 'react'
import { useHub } from '../../store'

const LOCAL_DICT = {
  'updates.expand': { en: 'Expand', zh: '展开' },
  'updates.collapse': { en: 'Collapse', zh: '收起' },
  'updates.retry': { en: 'Retry', zh: '重试' },
  'updates.feedError': { en: 'Could not load the mission log.', zh: '无法加载任务日志。' },
} as const

export type LocalKey = keyof typeof LOCAL_DICT

/** t-like helper for keys pending centralization (EN + zh-CN baked in). */
export function useLocalT(): (key: LocalKey) => string {
  const { lang } = useHub()
  return useCallback((key: LocalKey) => LOCAL_DICT[key][lang], [lang])
}
