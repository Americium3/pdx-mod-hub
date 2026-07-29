import type { Lang } from './i18n'
import { translate } from './i18n'

export function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v >= 10 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`
}

export function formatCount(n: number | undefined): string {
  if (n === undefined) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}K`
  if (n >= 1_000) return `${(n / 1000).toFixed(1)}K`
  return String(n)
}

export function relTime(lang: Lang, ts: number | undefined): string {
  if (!ts) return translate(lang, 'misc.never')
  const delta = Math.floor(Date.now() / 1000) - ts
  if (delta < 90) return translate(lang, 'misc.justNow')
  if (delta < 3600) return translate(lang, 'misc.minAgo', { n: Math.round(delta / 60) })
  if (delta < 86400 * 2) return translate(lang, 'misc.hourAgo', { n: Math.round(delta / 3600) })
  if (delta < 86400 * 30) return translate(lang, 'misc.dayAgo', { n: Math.round(delta / 86400) })
  return absDate(lang, ts)
}

export function absDate(lang: Lang, ts: number | undefined): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function absDateTime(lang: Lang, ts: number | undefined): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
