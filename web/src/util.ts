// Formatting + heraldry utilities. All times formatted client-side from
// epoch ints via Intl — zero time strings in the i18n dict.
import type { Lang } from './i18n'
import { translate } from './i18n'

export function localeOf(lang: Lang): string {
  return lang === 'zh' ? 'zh-CN' : 'en-US'
}

/* ---------- Sizes: fixed precision, "142.6 MB" ---------- */

export function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || bytes <= 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v.toFixed(1)} ${units[u]}`
}

/** Signed delta, e.g. "+1.2 MB" / "-380.0 KB". */
export function formatSizeDelta(bytes: number | undefined | null): string {
  if (!bytes) return '—'
  const sign = bytes > 0 ? '+' : '−'
  return `${sign}${formatBytes(Math.abs(bytes))}`
}

/* ---------- Counts: exact commas in tables, "128.9k" in card footers ---------- */

const exactFmt = new Intl.NumberFormat('en-US')

export function formatCountExact(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—'
  return exactFmt.format(n)
}

export function formatCountCompact(n: number | undefined | null): string {
  if (n === undefined || n === null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

/* ---------- Times: Intl from epoch seconds ---------- */

const REL_STEPS: { limit: number; div: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { limit: 60, div: 1, unit: 'second' },
  { limit: 3600, div: 60, unit: 'minute' },
  { limit: 86400, div: 3600, unit: 'hour' },
  { limit: 86400 * 30, div: 86400, unit: 'day' },
  { limit: 86400 * 365, div: 86400 * 30, unit: 'month' },
  { limit: Infinity, div: 86400 * 365, unit: 'year' },
]

/** "2 hours ago" / "2小时前" via Intl.RelativeTimeFormat. */
export function relTime(lang: Lang, ts: number | undefined | null): string {
  if (!ts) return translate(lang, 'misc.never')
  const delta = Math.floor(Date.now() / 1000) - ts
  if (delta < 45 && delta > -45) return translate(lang, 'misc.justNow')
  const rtf = new Intl.RelativeTimeFormat(localeOf(lang), { numeric: 'auto' })
  const abs = Math.abs(delta)
  for (const step of REL_STEPS) {
    if (abs < step.limit) return rtf.format(Math.round(-delta / step.div), step.unit)
  }
  return '—'
}

export function absDate(lang: Lang, ts: number | undefined | null): string {
  if (!ts) return '—'
  return new Intl.DateTimeFormat(localeOf(lang), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(ts * 1000))
}

export function absDateTime(lang: Lang, ts: number | undefined | null): string {
  if (!ts) return '—'
  return new Intl.DateTimeFormat(localeOf(lang), {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts * 1000))
}

/** "14:32" — mono/ASCII in both locales (stamps, mini-log). */
export function clockTime(ts: number | undefined | null): string {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a * 1000)
  const db = new Date(b * 1000)
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  )
}

/** Feed day-separator label: TODAY / YESTERDAY / "Jul 13". */
export function dayLabel(lang: Lang, ts: number): string {
  const now = Math.floor(Date.now() / 1000)
  if (isSameDay(ts, now)) return translate(lang, 'misc.today')
  if (isSameDay(ts, now - 86400)) return translate(lang, 'misc.yesterday')
  return absDate(lang, ts)
}

/** Ops-bar poll countdown, 10s granularity: "T−03:10". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds / 10) * 10)
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `T−${mm}:${ss}`
}

/** "32m" / "2h" staleness shorthand for the STALE readout. */
export function shortAge(seconds: number): string {
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

/* ---------- Reserved widths (EN <-> zh zero layout shift) ---------- */

/**
 * Estimate a string's rendered width in em (CJK = 1em, latin ~ 0.58em).
 * Used for min-width reservation; the ReservedText component gives exact
 * double-render reservation where it matters most.
 */
export function estimateEm(text: string): number {
  let em = 0
  for (const ch of text) {
    if (/[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch)) em += 1
    else if (ch === ' ') em += 0.3
    else em += 0.58
  }
  return em
}

/** Max estimated width across variants, as a CSS min-width value. */
export function reservedEm(...texts: string[]): string {
  const max = Math.max(0, ...texts.map(estimateEm))
  return `${Math.ceil(max * 100) / 100}em`
}

/* ---------- Per-game heraldry ---------- */

export type GameKey =
  | 'hoi4'
  | 'stellaris'
  | 'vic3'
  | 'ck3'
  | 'eu4'
  | 'eu5'
  | 'aow4'
  | 'millennia'
  | 'other'

const APP_KEYS: Record<number, GameKey> = {
  394360: 'hoi4',
  281990: 'stellaris',
  529340: 'vic3',
  1158310: 'ck3',
  236850: 'eu4',
  1669000: 'aow4',
  1268590: 'millennia',
}

const SHORT_NAMES: Record<GameKey, string> = {
  hoi4: 'HOI4',
  stellaris: 'STE',
  vic3: 'VIC3',
  ck3: 'CK3',
  eu4: 'EU4',
  eu5: 'EU5',
  aow4: 'AOW4',
  millennia: 'MIL',
  other: 'PDX',
}

export function gameKey(appId: number, name?: string): GameKey {
  const direct = APP_KEYS[appId]
  if (direct) return direct
  const n = (name ?? '').toLowerCase()
  if (n.includes('hearts of iron')) return 'hoi4'
  if (n.includes('stellaris')) return 'stellaris'
  if (n.includes('victoria')) return 'vic3'
  if (n.includes('crusader kings')) return 'ck3'
  if (n.includes('europa universalis v') || n.includes('europa universalis 5')) return 'eu5'
  if (n.includes('europa universalis')) return 'eu4'
  if (n.includes('age of wonders')) return 'aow4'
  if (n.includes('millennia')) return 'millennia'
  return 'other'
}

/** Heraldic hue as a CSS var reference (falls back to text-3 for unknowns). */
export function gameColor(appId: number, name?: string): string {
  const key = gameKey(appId, name)
  return key === 'other' ? 'var(--text-3)' : `var(--game-${key})`
}

/** Short mono code for glyphs/fallback tiles: "HOI4", "CK3", ... */
export function gameShort(appId: number, name?: string): string {
  return SHORT_NAMES[gameKey(appId, name)]
}

/** Deterministic initials for image-fallback tiles: "Kaiserreich" -> "KR". */
export function modInitials(title: string): string {
  const words = title
    .replace(/[[\](){}]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/* ---------- Fuzzy matching (command palette / quick filters) ---------- */

/** Subsequence fuzzy score; higher is better, null when no match. */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (!q) return 0
  const idx = t.indexOf(q)
  if (idx >= 0) return 1000 - idx - (t.length - q.length) * 0.01
  let ti = 0
  let score = 0
  let streak = 0
  for (const ch of q) {
    const found = t.indexOf(ch, ti)
    if (found < 0) return null
    streak = found === ti ? streak + 1 : 1
    score += 10 + streak * 5 - (found - ti)
    ti = found + 1
  }
  return score
}
