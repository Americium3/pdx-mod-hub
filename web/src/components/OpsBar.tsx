import { AnimatePresence, motion } from 'framer-motion'
import { RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import type { MsgKey } from '../i18n'
import { SNAP, useReducedMotionSafe } from '../motion'
import { useHub } from '../store'
import { formatCountdown, shortAge } from '../util'
import { KbdChip } from './KbdChip'
import { SplitFlap } from './SplitFlap'
import { ThemeControl } from './ThemeControl'

const IS_MAC = /mac/i.test(navigator.platform)

/** Countdown to next poll, ticking at 10-SECOND granularity (never per-second). */
function PollReadout(): ReactNode {
  const { state, t } = useHub()
  const [, force] = useState(0)

  useEffect(() => {
    // Internal 1s tick; the DISPLAYED string only changes every 10s,
    // so split-flap digits roll only on displayed-digit change.
    const timer = setInterval(() => force(x => x + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  if (!state) return <span className="voice-mono-sm text-[var(--text-3)]">{t('ops.poll')} —</span>

  const { lastPoll } = state
  const intervalSec = state.settings?.pollIntervalSec ?? 300
  const now = Math.floor(Date.now() / 1000)

  if (lastPoll.status === 'failed') {
    return <span className="voice-mono-sm text-[var(--state-error)]">{t('ops.pollFailed')}</span>
  }

  const age = lastPoll.at ? now - lastPoll.at : Infinity
  if (age > intervalSec * 2 + 60) {
    const label = lastPoll.at ? shortAge(age) : '—'
    return (
      <span className="voice-mono-sm text-[var(--accent-text)]">{t('ops.stale', { t: label })}</span>
    )
  }

  const remaining = Math.max(0, lastPoll.at + intervalSec - now)
  return (
    <span className="voice-mono-sm inline-flex items-center gap-[6px] text-[var(--text-2)]">
      <span className="text-[var(--text-3)]">{t('ops.poll')}</span>
      <SplitFlap text={formatCountdown(remaining)} className="tabular" />
    </span>
  )
}

function Led({ on, onLabel, offLabel, name }: { on: boolean; onLabel: string; offLabel: string; name: string }): ReactNode {
  return (
    <span className="voice-mono-sm inline-flex items-center gap-[5px]">
      <span className="text-[var(--text-3)]">{name}</span>
      <span
        className="inline-block h-[6px] w-[6px] rounded-full"
        style={
          on
            ? { background: 'var(--state-fetched)' }
            : { background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--state-error)' }
        }
      />
      <span className={on ? 'text-[var(--text-2)]' : 'text-[var(--state-error)]'}>
        {on ? onLabel : offLabel}
      </span>
    </span>
  )
}

/**
 * OPS BAR — 40px on every page; the app's honesty surface.
 * Right cluster, exact order: POLL · STEAM LED · LINK · (HELPER) ·
 * [n AWAITING] · refresh · theme · ⌘K.
 */
export function OpsBar({
  titleKey,
  onPalette,
  children,
}: {
  titleKey: MsgKey
  onPalette: () => void
  children?: ReactNode
}): ReactNode {
  const { state, t, refresh, pendingCount, sseConnected, helperActive, navigate } = useHub()
  const snap = useReducedMotionSafe(SNAP)

  // Radar 360-once on poll completion (lastPoll.at change), never continuous.
  const [spinning, setSpinning] = useState(false)
  const lastPollAt = useRef<number | undefined>(state?.lastPoll.at)
  useEffect(() => {
    const at = state?.lastPoll.at
    if (at !== undefined && lastPollAt.current !== undefined && at !== lastPollAt.current) {
      setSpinning(true)
      const timer = setTimeout(() => setSpinning(false), 650)
      return () => clearTimeout(timer)
    }
    lastPollAt.current = at
    return undefined
  }, [state?.lastPoll.at])
  useEffect(() => {
    lastPollAt.current = state?.lastPoll.at
  }, [state?.lastPoll.at])

  // AWAITING badge pulses exactly 3 cycles on increase, then holds.
  const prevPending = useRef(pendingCount)
  const [pulseKey, setPulseKey] = useState(0)
  useEffect(() => {
    if (pendingCount > prevPending.current) setPulseKey(k => k + 1)
    prevPending.current = pendingCount
  }, [pendingCount])

  const checkNow = (): void => {
    api
      .checkNow()
      .then(() => refresh())
      .catch(() => void refresh())
  }

  return (
    <header className="relative z-10 flex h-[40px] shrink-0 items-center gap-[16px] border-b border-[var(--line-1)] bg-[var(--bg-0)] pr-[12px] pl-[20px]">
      <h1 className="voice-label-page whitespace-nowrap">{t(titleKey)}</h1>
      <div className="flex min-w-0 flex-1 items-center gap-[8px]">{children}</div>

      <div className="flex shrink-0 items-center gap-[14px]">
        <PollReadout />

        <Led
          on={state?.steamRunning ?? false}
          onLabel={t('ops.running')}
          offLabel={t('ops.offline')}
          name={t('ops.steam')}
        />

        <span className="voice-mono-sm inline-flex items-center gap-[5px]" title="SSE">
          <span className="text-[var(--text-3)]">{t('ops.link')}</span>
          <span
            className="inline-block h-[6px] w-[6px] rounded-full"
            style={
              sseConnected
                ? { background: 'var(--state-fetched)' }
                : { background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--state-error)' }
            }
          />
        </span>

        <AnimatePresence>
          {helperActive ? (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="voice-mono-sm inline-flex items-center gap-[5px] rounded-chip border border-[var(--line-2)] px-[6px] py-[1px] text-[var(--text-2)]"
            >
              {t('ops.helper')}
              <span className="inline-block h-[6px] w-[6px] rounded-full bg-[var(--state-downloading)]" />
            </motion.span>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {pendingCount > 0 ? (
            <motion.button
              type="button"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={snap}
              key="awaiting-badge"
              onClick={() => navigate({ page: 'updates', mod: null })}
              className="cursor-pointer"
              title={t('nav.updates')}
            >
              <span
                key={pulseKey}
                className={`voice-mono-sm inline-flex items-center rounded-chip border border-[var(--state-pending)] bg-[var(--state-pending-tint,transparent)] px-[6px] py-[1px] text-[var(--state-pending)] ${pulseKey > 0 ? 'badge-pulse' : ''}`}
                style={{ background: 'var(--state-pending-tint)' }}
              >
                {t('ops.awaiting', { n: pendingCount })}
              </span>
            </motion.button>
          ) : null}
        </AnimatePresence>

        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          transition={snap}
          onClick={checkNow}
          title={t('ops.refresh')}
          className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-std text-[var(--text-2)] hover:bg-[var(--bg-2)] hover:text-[var(--text-1)]"
        >
          <RefreshCw size={16} strokeWidth={1.75} className={spinning ? 'radar-spin' : ''} />
        </motion.button>

        <ThemeControl />

        <button type="button" onClick={onPalette} className="cursor-pointer" title="Command palette">
          <KbdChip>{IS_MAC ? '⌘K' : 'Ctrl K'}</KbdChip>
        </button>
      </div>
    </header>
  )
}
