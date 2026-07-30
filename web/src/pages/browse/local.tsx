// Local bilingual fallbacks for i18n keys that do not exist yet in the shared
// dict (web/src/i18n.ts is owned by the integrator). Every key used here is
// reported in the build output's missingI18nKeys so it can be centralized.
import { useCallback, type ReactNode } from 'react'
import { useHub } from '../../store'

const LOCAL = {
  'browse.sort.relevance': { en: 'Relevance', zh: '相关性' },
  'browse.sort.alltime': { en: 'All time', zh: '全部时间' },
  'browse.noticeDismiss': { en: 'Got it', zh: '知道了' },
  'browse.loadFailed': { en: 'Could not load Workshop results.', zh: '无法加载创意工坊结果。' },
  'action.retry': { en: 'Retry', zh: '重试' },
  'misc.cancel': { en: 'Cancel', zh: '取消' },
} as const

export type LocalKey = keyof typeof LOCAL

/** t-like helper for the local fallback keys above. */
export function useLocalT(): (key: LocalKey) => string {
  const { lang } = useHub()
  return useCallback((key: LocalKey) => LOCAL[key][lang], [lang])
}

/** Reserved-width rendering for local fallback keys (mirrors ReservedText). */
export function LocalReserved({
  k,
  center,
  className,
}: {
  k: LocalKey
  center?: boolean
  className?: string
}): ReactNode {
  const { lang } = useHub()
  const p = LOCAL[k]
  const active = lang === 'zh' ? p.zh : p.en
  const ghost = lang === 'zh' ? p.en : p.zh
  return (
    <span className={`reserve ${center ? 'reserve-center' : ''} ${className ?? ''}`}>
      <span className="reserve-ghost" aria-hidden="true">
        {ghost}
      </span>
      <span>{active}</span>
    </span>
  )
}
