import type { ReactNode } from 'react'
import type { MsgKey } from '../i18n'
import { pair } from '../i18n'
import { useHub } from '../store'

/**
 * Bilingual label with exact reserved width: renders BOTH locale variants
 * stacked in one grid cell (the inactive one invisible), so switching
 * EN <-> 中文 causes zero layout shift anywhere it is used.
 */
export function ReservedText({
  k,
  vars,
  center,
  className,
}: {
  k: MsgKey
  vars?: Record<string, string | number>
  center?: boolean
  className?: string
}): ReactNode {
  const { lang } = useHub()
  const p = pair(k, vars)
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

/** Same reservation trick for two arbitrary strings (e.g. EN/中 toggle segments). */
export function ReservedPair({
  a,
  b,
  active,
  className,
}: {
  a: string
  b: string
  active: string
  className?: string
}): ReactNode {
  return (
    <span className={`reserve reserve-center ${className ?? ''}`}>
      <span className="reserve-ghost" aria-hidden="true">
        {a}
      </span>
      <span className="reserve-ghost" aria-hidden="true">
        {b}
      </span>
      <span>{active}</span>
    </span>
  )
}
