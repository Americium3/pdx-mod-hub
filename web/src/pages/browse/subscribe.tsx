// Subscribe plumbing for the Browse page: optimistic pending tracking against
// the store's SSE-driven action map, the state-aware Subscribe control
// (button -> SUBSCRIBED / INSTALLED chips), and the required-items dialog.
import { motion } from 'framer-motion'
import { Check } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { Button } from '../../components/Button'
import { ReservedText } from '../../components/ReservedText'
import { DUR } from '../../motion'
import { useHub } from '../../store'
import type { ActionStage, BrowseItem } from '../../types'

/** Stages that mean the account-side subscribe has gone through. */
const OK_STAGES: readonly ActionStage[] = [
  'subscribed',
  'downloading',
  'result',
  'acf_confirmed',
  'result_ok_unconfirmed',
]

/** Sentinel while the 202 {actionId} round-trip is still in flight. */
const REQUESTED = '__requested__'

export interface SubscriptionsApi {
  /** mods with a subscribe action currently in flight */
  pending: ReadonlySet<string>
  /** mods optimistically settled as subscribed during this session */
  settled: ReadonlySet<string>
  subscribe: (modId: string, withChildren?: string[]) => void
}

/**
 * POST /api/actions/subscribe returns 202 + actionId; progress arrives as SSE
 * action pokes which the store folds into `actions`. The button flips to an
 * optimistic pending state immediately and settles once the action reports a
 * subscribed-or-later stage (or fails — store already toasts failures).
 */
export function useSubscriptions(appId: number | null): SubscriptionsApi {
  const { actions, runAction } = useHub()
  const [pendingByMod, setPendingByMod] = useState<Record<string, string>>({})
  const [settledIds, setSettledIds] = useState<ReadonlySet<string>>(() => new Set())

  const subscribe = useCallback(
    (modId: string, withChildren?: string[]) => {
      if (appId === null) return
      setPendingByMod(prev => ({ ...prev, [modId]: REQUESTED }))
      void (async () => {
        const extra = (withChildren ?? []).filter(id => id !== modId)
        const actionId = await runAction(
          'subscribe',
          extra.length > 0 ? { appId, modIds: [modId, ...extra] } : { appId, modId },
        )
        if (actionId === null) {
          // 409 / transport failure — store toasted; revert the pending state.
          setPendingByMod(prev => {
            if (!(modId in prev)) return prev
            const next = { ...prev }
            delete next[modId]
            return next
          })
        } else {
          setPendingByMod(prev =>
            prev[modId] === REQUESTED ? { ...prev, [modId]: actionId } : prev,
          )
        }
      })()
    },
    [appId, runAction],
  )

  // Settle pending entries as the SSE action stages roll in. Terminal actions
  // are dropped from the store map ~6s after finishing; a vanished entry means
  // it completed (failed would have been observed at its 'failed' stage).
  useEffect(() => {
    const ok: string[] = []
    const failed: string[] = []
    for (const [modId, actionId] of Object.entries(pendingByMod)) {
      if (actionId === REQUESTED) continue
      const a = actions[actionId]
      if (!a) ok.push(modId)
      else if (a.stage === 'failed') failed.push(modId)
      else if (OK_STAGES.includes(a.stage)) ok.push(modId)
    }
    if (ok.length === 0 && failed.length === 0) return
    setPendingByMod(prev => {
      const next = { ...prev }
      for (const modId of [...ok, ...failed]) delete next[modId]
      return next
    })
    if (ok.length > 0) {
      setSettledIds(prev => {
        const next = new Set(prev)
        for (const modId of ok) next.add(modId)
        return next
      })
    }
  }, [actions, pendingByMod])

  const pending = useMemo(() => new Set(Object.keys(pendingByMod)), [pendingByMod])

  return { pending, settled: settledIds, subscribe }
}

/* ---------- Status chips ---------- */

/**
 * SUBSCRIBED (check icon) / INSTALLED chips (cross-referenced server-side,
 * plus this session's optimistic settles). `onArt` renders night-side literals
 * with a dark backing so the chip stays legible over Steam art in both themes.
 */
export function StatusChip({
  kind,
  onArt = false,
  className,
}: {
  kind: 'subscribed' | 'installed'
  onArt?: boolean
  className?: string
}): ReactNode {
  const { t } = useHub()
  const label = kind === 'subscribed' ? t('browse.subscribed') : t('browse.installed')
  const style: CSSProperties = onArt
    ? { borderColor: '#55c186', color: '#55c186', background: 'rgba(10, 12, 14, 0.72)' }
    : { borderColor: 'var(--state-fetched)', color: 'var(--state-fetched)' }
  return (
    <span
      className={`inline-flex items-center gap-[3px] rounded-chip border px-[6px] py-[2px] font-mono text-[10px] font-medium tracking-[0.08em] whitespace-nowrap uppercase ${className ?? ''}`}
      style={style}
      data-chip={kind}
    >
      {kind === 'subscribed' ? <Check size={11} strokeWidth={2.5} aria-hidden="true" /> : null}
      {label}
    </span>
  )
}

/* ---------- The state-aware Subscribe control ---------- */

/** Night-side token overrides so the shared secondary Button reads over art. */
const ON_ART_VARS = {
  '--text-1': '#e9eef2',
  '--line-2': 'rgba(255, 255, 255, 0.35)',
  '--bg-2': 'rgba(23, 28, 32, 0.85)',
} as CSSProperties

export function SubscribeControl({
  item,
  subs,
  onRequest,
  onArt = false,
}: {
  item: BrowseItem
  subs: SubscriptionsApi
  /** page-level handler — routes through the required-items dialog */
  onRequest: (item: BrowseItem) => void
  onArt?: boolean
}): ReactNode {
  if (item.installed) return <StatusChip kind="installed" onArt={onArt} />
  if (item.subscribed || subs.settled.has(item.id)) {
    return <StatusChip kind="subscribed" onArt={onArt} />
  }
  const pending = subs.pending.has(item.id)
  const button = (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={e => {
        e.stopPropagation()
        onRequest(item)
      }}
    >
      <ReservedText k={pending ? 'action.working' : 'action.subscribe'} center />
    </Button>
  )
  if (!onArt) return button
  return (
    <span
      className="inline-flex rounded-std"
      style={{ ...ON_ART_VARS, background: 'rgba(10, 12, 14, 0.72)' }}
    >
      {button}
    </span>
  )
}

/* ---------- Required-items dialog (mirrors Steam) ---------- */

export function RequiredItemsDialog({
  item,
  onCancel,
  onConfirm,
}: {
  item: BrowseItem
  onCancel: () => void
  /** subscribe to the mod plus all of its required children */
  onConfirm: () => void
}): ReactNode {
  const { t } = useHub()
  const children = item.children ?? []

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onCancel])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" role="dialog" aria-modal="true">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: DUR.palette }}
        className="absolute inset-0 bg-[rgba(0,0,0,0.45)]"
        onClick={onCancel}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: DUR.palette }}
        className="relative w-[420px] max-w-[90vw] rounded-std border border-[var(--line-1)] bg-[var(--bg-3)] p-[16px]"
        style={{ boxShadow: 'var(--shadow-float)' }}
      >
        <div className="voice-title pb-[2px] text-[var(--text-1)]">{item.title}</div>
        <div className="voice-ui pb-[10px] text-[var(--text-2)]">
          {t('browse.requiredItems', { n: children.length })}
        </div>
        <div className="voice-label pb-[4px]">{t('meta.dependencies')}</div>
        <div className="max-h-[200px] overflow-y-auto rounded-std border border-[var(--line-div)] bg-[var(--inset)] px-[10px] py-[6px]">
          {children.map(id => (
            <div key={id} className="voice-mono tabular py-[2px] text-[var(--text-2)]">
              {id}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-[8px] pt-[14px]">
          <Button variant="secondary" onClick={onCancel}>
            <ReservedText k="misc.cancel" center />
          </Button>
          <Button variant="primary" onClick={onConfirm}>
            <ReservedText k="browse.subscribeAll" center />
          </Button>
        </div>
      </motion.div>
    </div>
  )
}
