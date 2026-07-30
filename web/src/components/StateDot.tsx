import type { CSSProperties, ReactNode } from 'react'
import type { MsgKey } from '../i18n'
import { useHub } from '../store'
import type { ModState } from '../types'

const STATE_COLOR: Record<ModState, string> = {
  'awaiting-steam': 'var(--state-pending)',
  'queued-for-launch': 'var(--state-pending-dim)',
  downloading: 'var(--state-downloading)',
  'up-to-date': 'var(--state-uptodate)',
  'not-installed': 'transparent',
  orphaned: 'var(--state-orphaned)',
  unverified: 'var(--state-orphaned)',
  removed: 'var(--state-error)',
  banned: 'var(--state-error)',
  error: 'var(--state-error)',
}

const STATE_KEY: Record<ModState, MsgKey> = {
  'awaiting-steam': 'state.awaiting-steam',
  'queued-for-launch': 'state.queued-for-launch',
  downloading: 'state.downloading',
  'up-to-date': 'state.up-to-date',
  'not-installed': 'state.not-installed',
  orphaned: 'state.orphaned',
  unverified: 'state.unverified',
  removed: 'state.removed',
  banned: 'state.banned',
  error: 'state.error',
}

export function stateColor(state: ModState): string {
  return state === 'not-installed' ? 'var(--line-2)' : STATE_COLOR[state]
}

/**
 * Status everywhere outside heroes: 6px dot + plain 13px label.
 * not-installed renders as a hollow 6px ring in --line-2 (both themes);
 * awaiting keeps the rationed breathing.
 */
export function StateDot({
  state,
  label = true,
  className,
}: {
  state: ModState
  label?: boolean
  className?: string
}): ReactNode {
  const { t } = useHub()
  const hollow = state === 'not-installed'
  const dotStyle: CSSProperties = hollow
    ? { background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--line-2)' }
    : { background: STATE_COLOR[state] }
  return (
    <span className={`inline-flex items-center gap-[7px] text-[13px] text-[var(--text-2)] ${className ?? ''}`}>
      <span
        className={`inline-block h-[6px] w-[6px] shrink-0 rounded-full ${state === 'awaiting-steam' ? 'dot-breathe' : ''}`}
        style={dotStyle}
      />
      {label ? t(STATE_KEY[state]) : null}
    </span>
  )
}
