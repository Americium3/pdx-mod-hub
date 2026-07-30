// Pinned LAUNCH QUEUE strip (DESIGN_SPEC §6.1): AWAITING STEAM chips with
// breathing dots + per-chip force-download on hover, Force-download-all
// cascade control, RECEIVED TODAY mini-log. At >=1400px it renders as a
// sticky right sidebar (queue rows / received today / stat strip).
// Queue <-> received migration glides via per-mod layoutId (MOVE).
import { motion } from 'framer-motion'
import { Check, CheckCircle2, Download } from 'lucide-react'
import type { ReactNode } from 'react'
import { img } from '../../api'
import { Button } from '../../components/Button'
import { MOVE, useReducedMotionSafe } from '../../motion'
import { useHub } from '../../store'
import type { FeedEvent, ModSummary } from '../../types'
import { clockTime, modInitials } from '../../util'

export interface CascadeState {
  done: number
  total: number
}

export interface QueueProps {
  /** mods in awaiting-steam, top-to-bottom cascade order */
  awaiting: ModSummary[]
  /** 'downloaded' events from today, newest first, capped at 5 */
  received: FeedEvent[]
  /** chips locally flipped to downloading by the cascade / per-chip force */
  flipped: ReadonlySet<string>
  cascade: CascadeState | null
  onForceAll: () => void
  onForceOne: (mod: ModSummary) => void
  steamRunning: boolean
  /** "206 mods · 38.4 GB · 8 games" (sidebar stat strip) */
  statLine: string
}

function MiniThumb({ mod }: { mod: ModSummary }): ReactNode {
  const proxied = img(mod.previewUrl)
  return (
    <span
      className="flex h-[18px] w-[38px] shrink-0 items-center justify-center overflow-hidden rounded-chip"
      style={{ background: 'var(--img-base)', border: '1px solid var(--img-border)' }}
      aria-hidden="true"
    >
      {proxied ? (
        <img src={proxied} alt="" loading="lazy" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <span className="font-label text-[8px] font-semibold text-[var(--text-3)] uppercase">
          {modInitials(mod.title)}
        </span>
      )}
    </span>
  )
}

function StateDotMini({ downloading }: { downloading: boolean }): ReactNode {
  return (
    <span
      className={`inline-block h-[6px] w-[6px] shrink-0 rounded-full ${downloading ? '' : 'dot-breathe'}`}
      style={{ background: downloading ? 'var(--state-downloading)' : 'var(--state-pending)' }}
      aria-hidden="true"
    />
  )
}

function ForceOneButton({
  mod,
  onForceOne,
  steamRunning,
  hoverClass,
}: {
  mod: ModSummary
  onForceOne: (mod: ModSummary) => void
  steamRunning: boolean
  hoverClass: string
}): ReactNode {
  const { t } = useHub()
  return (
    <button
      type="button"
      onClick={e => {
        e.stopPropagation()
        onForceOne(mod)
      }}
      disabled={!steamRunning}
      title={steamRunning ? t('action.force') : t('misc.steamDown')}
      aria-label={t('action.force')}
      className={`flex h-[18px] w-[18px] shrink-0 cursor-pointer items-center justify-center rounded-chip text-[var(--text-3)] hover:bg-[var(--bg-2)] hover:text-[var(--accent-text)] disabled:pointer-events-none disabled:opacity-40 ${hoverClass}`}
    >
      <Download size={12} strokeWidth={1.75} />
    </button>
  )
}

/** Force-all button that morphs into a mono progress pill via layoutId. */
function ForceAllControl({
  cascade,
  onForceAll,
  disabled,
}: {
  cascade: CascadeState | null
  onForceAll: () => void
  disabled: boolean
}): ReactNode {
  const { t } = useHub()
  const move = useReducedMotionSafe(MOVE)
  if (cascade) {
    return (
      <motion.div
        layoutId="pmh-forceall"
        layout
        transition={move}
        className="voice-mono-sm flex h-[28px] items-center gap-[7px] rounded-std border border-[var(--state-downloading)] px-[10px] text-[var(--state-downloading)] tabular"
      >
        <span className="inline-block h-[6px] w-[6px] rounded-full bg-[var(--state-downloading)]" />
        {cascade.done}/{cascade.total}
      </motion.div>
    )
  }
  return (
    <motion.div layoutId="pmh-forceall" layout transition={move}>
      <Button variant="primary" onClick={onForceAll} disabled={disabled}>
        {t('updates.forceAll')}
      </Button>
    </motion.div>
  )
}

function AllClear(): ReactNode {
  const { t } = useHub()
  return (
    <div className="flex items-center gap-[8px] text-[13px] text-[var(--text-2)]">
      <CheckCircle2 size={16} strokeWidth={1.75} style={{ color: 'var(--state-fetched)' }} />
      {t('updates.allClear')}
    </div>
  )
}

function ReceivedRow({
  event,
  withLayoutId,
}: {
  event: FeedEvent
  withLayoutId: boolean
}): ReactNode {
  const move = useReducedMotionSafe(MOVE)
  return (
    <motion.div
      layoutId={withLayoutId ? `lq-${event.modId}` : undefined}
      layout
      transition={move}
      className="flex h-[24px] items-center gap-[7px]"
    >
      <Check size={12} strokeWidth={2} className="shrink-0" style={{ color: 'var(--state-fetched)' }} />
      <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-2)]">{event.title}</span>
      <span className="voice-mono-sm shrink-0 text-[var(--text-3)] tabular">
        {clockTime(event.detectedAt)}
      </span>
    </motion.div>
  )
}

function receivedRows(received: FeedEvent[], awaitingIds: ReadonlySet<string>): ReactNode {
  const seen = new Set<string>()
  return received.map(e => {
    const first = !seen.has(e.modId)
    seen.add(e.modId)
    return <ReceivedRow key={e.seq} event={e} withLayoutId={first && !awaitingIds.has(e.modId)} />
  })
}

/* ---------- <1400px: pinned strip over the log column ---------- */

export function LaunchQueueStrip(props: QueueProps): ReactNode {
  const { t } = useHub()
  const move = useReducedMotionSafe(MOVE)
  const { awaiting, received, flipped, cascade, onForceAll, onForceOne, steamRunning } = props
  const awaitingIds = new Set(awaiting.map(m => m.id))

  return (
    <div className="sticky top-0 z-10 border-b border-[var(--line-1)] bg-[var(--bg-0)] pt-[16px] pb-[12px]">
      <div className="flex items-start gap-[20px]">
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-[12px] pb-[8px]">
            <span className="voice-label">{t('updates.launchQueue', { n: awaiting.length })}</span>
            {awaiting.length > 0 ? (
              <ForceAllControl
                cascade={cascade}
                onForceAll={onForceAll}
                disabled={!steamRunning || cascade !== null}
              />
            ) : null}
          </div>

          {awaiting.length === 0 ? (
            <AllClear />
          ) : (
            <div className="flex flex-wrap items-center gap-[6px]">
              {awaiting.map(mod => {
                const downloading = flipped.has(mod.id) || mod.state === 'downloading'
                return (
                  <motion.div
                    key={mod.id}
                    layoutId={`lq-${mod.id}`}
                    layout
                    transition={move}
                    whileTap={{ scale: 0.985 }}
                    className="group/chip flex h-[26px] items-center gap-[7px] rounded-std border border-[var(--line-1)] bg-[var(--bg-1)] pr-[8px] pl-[3px]"
                    style={{ boxShadow: 'var(--edge-highlight)' }}
                  >
                    <MiniThumb mod={mod} />
                    <span className="max-w-[150px] truncate text-[13px] text-[var(--text-1)]">
                      {mod.title}
                    </span>
                    <StateDotMini downloading={downloading} />
                    {!downloading ? (
                      <ForceOneButton
                        mod={mod}
                        onForceOne={onForceOne}
                        steamRunning={steamRunning}
                        hoverClass="opacity-0 transition-opacity duration-150 group-hover/chip:opacity-100 focus-visible:opacity-100"
                      />
                    ) : null}
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>

        {/* RECEIVED TODAY mini-log — check + name + hh:mm, last 5. */}
        <div className="hidden w-[240px] shrink-0 border-l border-[var(--line-div)] pl-[16px] md:block">
          <div className="voice-label pb-[6px]">{t('updates.receivedToday')}</div>
          {received.length === 0 ? (
            <span className="voice-mono-sm text-[var(--text-3)]">—</span>
          ) : (
            <div className="flex flex-col">{receivedRows(received, awaitingIds)}</div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- >=1400px: sticky right sidebar, 260px, hairline-separated ---------- */

export function LaunchQueueSidebar(props: QueueProps): ReactNode {
  const { t } = useHub()
  const move = useReducedMotionSafe(MOVE)
  const { awaiting, received, flipped, cascade, onForceAll, onForceOne, steamRunning, statLine } =
    props
  const awaitingIds = new Set(awaiting.map(m => m.id))

  return (
    <aside className="sticky top-[16px] flex w-[260px] shrink-0 flex-col self-start">
      <div className="flex items-center justify-between gap-[8px] pb-[8px]">
        <span className="voice-label">{t('updates.launchQueue', { n: awaiting.length })}</span>
      </div>

      {awaiting.length === 0 ? (
        <AllClear />
      ) : (
        <>
          <div className="flex flex-col">
            {awaiting.map(mod => {
              const downloading = flipped.has(mod.id) || mod.state === 'downloading'
              return (
                <motion.div
                  key={mod.id}
                  layoutId={`lq-${mod.id}`}
                  layout
                  transition={move}
                  whileTap={{ scale: 0.985 }}
                  className="group/qrow flex h-[30px] items-center gap-[8px]"
                >
                  <MiniThumb mod={mod} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-1)]">
                    {mod.title}
                  </span>
                  {!downloading ? (
                    <ForceOneButton
                      mod={mod}
                      onForceOne={onForceOne}
                      steamRunning={steamRunning}
                      hoverClass="opacity-0 transition-opacity duration-150 group-hover/qrow:opacity-100 focus-visible:opacity-100"
                    />
                  ) : null}
                  <StateDotMini downloading={downloading} />
                </motion.div>
              )
            })}
          </div>
          <div className="pt-[10px]">
            <ForceAllControl
              cascade={cascade}
              onForceAll={onForceAll}
              disabled={!steamRunning || cascade !== null}
            />
          </div>
        </>
      )}

      <div className="hairline-t mt-[14px] pt-[12px]">
        <div className="voice-label pb-[6px]">{t('updates.receivedToday')}</div>
        {received.length === 0 ? (
          <span className="voice-mono-sm text-[var(--text-3)]">—</span>
        ) : (
          <div className="flex flex-col">{receivedRows(received, awaitingIds)}</div>
        )}
      </div>

      {/* Stat strip: mods · GB · games. */}
      <div className="hairline-t mt-[14px] pt-[12px]">
        <span className="voice-mono-sm text-[var(--text-3)] tabular">{statLine}</span>
      </div>
    </aside>
  )
}
