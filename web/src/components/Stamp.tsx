import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import type { MsgKey } from '../i18n'
import { DUR, STAMP, useReducedMotionSafe } from '../motion'
import { useHub } from '../store'
import { clockTime } from '../util'

/** The exact bilingual stamp set from DESIGN_SPEC §5. */
export type StampState =
  | 'awaiting'
  | 'queued'
  | 'downloading'
  | 'fetched'
  | 'removed'
  | 'banned'
  | 'orphaned'
  | 'unverified'

const COLOR: Record<StampState, string> = {
  awaiting: 'var(--state-pending)',
  queued: 'var(--state-pending-dim)',
  downloading: 'var(--state-downloading)',
  fetched: 'var(--state-fetched)',
  removed: 'var(--state-error)',
  banned: 'var(--state-error)',
  orphaned: 'var(--state-orphaned)',
  unverified: 'var(--state-orphaned)',
}

const KEY: Record<StampState, MsgKey> = {
  awaiting: 'stamp.awaiting',
  queued: 'stamp.queued',
  downloading: 'stamp.downloading',
  fetched: 'stamp.fetched',
  removed: 'stamp.removed',
  banned: 'stamp.banned',
  orphaned: 'stamp.orphaned',
  unverified: 'stamp.unverified',
}

/**
 * Hero state component: 10px mono caps, 1px colored border, 2px radius,
 * transparent fill, 6px dot (breathing only while AWAITING).
 * `punch` fires the STAMP thunk (new SSE update-event arrival only);
 * ordinary state changes crossfade quietly in 120ms.
 */
export function Stamp({
  state,
  ts,
  punch = false,
  className,
}: {
  state: StampState
  /** epoch seconds for FETCHED hh:mm / ORPHANED as-of hh:mm */
  ts?: number
  punch?: boolean
  className?: string
}): ReactNode {
  const { t } = useHub()
  const thunk = useReducedMotionSafe(STAMP)
  const color = COLOR[state]
  const needsTime = state === 'fetched' || state === 'orphaned'
  const label = t(KEY[state], needsTime ? { t: clockTime(ts) } : undefined)

  return (
    <AnimatePresence mode="popLayout" initial={punch}>
      <motion.span
        key={state}
        initial={punch ? { opacity: 0, scale: 1.4, rotate: -6 } : { opacity: 0 }}
        animate={{ opacity: 1, scale: 1, rotate: 0 }}
        exit={{ opacity: 0, transition: { duration: DUR.stampSwap } }}
        transition={punch ? thunk : { duration: DUR.stampSwap }}
        className={`inline-flex items-center gap-[6px] rounded-chip border px-[6px] py-[2px] font-mono text-[10px] font-medium uppercase tracking-[0.08em] whitespace-nowrap ${className ?? ''}`}
        style={{ borderColor: color, color }}
        data-stamp={state}
      >
        <span
          className={`inline-block h-[6px] w-[6px] rounded-full ${state === 'awaiting' ? 'dot-breathe' : ''}`}
          style={{ background: color }}
        />
        {label}
      </motion.span>
    </AnimatePresence>
  )
}
