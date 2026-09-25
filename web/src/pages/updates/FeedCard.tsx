// Mission-log event card (DESIGN_SPEC §6.2): 2.14:1 hero (max 180px) with
// scrim-overlaid title + game pill + UPDATED hh:mm, stamp top-right, spine
// left edge with the money-moment narrative, lazy changelog excerpt, mono
// footer + hover actions. Removed/banned events render from snapshotted
// title/preview with an error spine.
import { motion, type Transition } from 'framer-motion'
import { Copy, Download, ExternalLink, MoreHorizontal } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Brackets } from '../../components/Brackets'
import { GamePill } from '../../components/GamePill'
import { ImageFrame } from '../../components/ImageFrame'
import { Spine, useMoneyMoment } from '../../components/Spine'
import { Stamp, type StampState } from '../../components/Stamp'
import { MOVE, SNAP, useReducedMotionSafe } from '../../motion'
import { useHub } from '../../store'
import type { FeedEvent, ModState, ModSummary } from '../../types'
import { clockTime, formatBytes, formatCountCompact, formatSizeDelta, relTime } from '../../util'
import { ChangelogBlock } from './ChangelogBlock'
import { useInView } from './hooks'

const STAMP_BY_STATE: Record<ModState, StampState> = {
  'awaiting-steam': 'awaiting',
  'queued-for-launch': 'queued',
  downloading: 'downloading',
  'up-to-date': 'fetched',
  'not-installed': 'awaiting',
  orphaned: 'orphaned',
  unverified: 'unverified',
  removed: 'removed',
  banned: 'banned',
  error: 'removed',
}

/** Delay before the punched stamp mounts: MOVE insert settle + 120ms. */
const PUNCH_DELAY_MS = 300

export function openInSteam(modId: string): void {
  location.assign(`steam://url/CommunityFilePage/${modId}`)
}

export function openInBrowser(modId: string): void {
  window.open(`https://steamcommunity.com/sharedfiles/filedetails/?id=${modId}`, '_blank', 'noopener')
}

function OverflowMenu({ modId }: { modId: string }): ReactNode {
  const { t, toast } = useHub()
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const copyId = (): void => {
    void navigator.clipboard
      .writeText(modId)
      .then(() => toast('success', t('toast.copied', { t: modId })))
      .catch(() => toast('error', t('toast.actionFailed', { e: 'clipboard' })))
    setOpen(false)
  }

  const itemCls =
    'flex w-full cursor-pointer items-center gap-[8px] px-[10px] py-[6px] text-left text-[13px] ' +
    'text-[var(--text-2)] hover:bg-[var(--bg-2)] hover:text-[var(--text-1)]'

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title={t('action.more')}
        aria-label={t('action.more')}
        aria-expanded={open}
        className="flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-std text-[var(--text-3)] hover:bg-[var(--bg-2)] hover:text-[var(--text-1)]"
      >
        <MoreHorizontal size={16} strokeWidth={1.75} />
      </button>
      {open ? (
        <div
          className="absolute right-0 bottom-[28px] z-20 min-w-[168px] overflow-hidden rounded-std border border-[var(--line-1)] bg-[var(--bg-3)] py-[4px]"
          style={{ boxShadow: 'var(--shadow-float)' }}
          role="menu"
        >
          <button type="button" role="menuitem" className={itemCls} onClick={copyId}>
            <Copy size={16} strokeWidth={1.75} />
            {t('action.copyId')}
          </button>
          <button
            type="button"
            role="menuitem"
            className={itemCls}
            onClick={() => {
              openInBrowser(modId)
              setOpen(false)
            }}
          >
            <ExternalLink size={16} strokeWidth={1.75} />
            {t('action.openBrowser')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function FeedCard({
  event,
  mod,
  gameName,
  fresh,
  entranceIdx,
}: {
  event: FeedEvent
  mod: ModSummary | undefined
  gameName?: string
  /** arrived live over SSE: MOVE glide in + STAMP thunk after settle */
  fresh: boolean
  /** 0..4 on route entry — 40ms stagger; undefined = no entrance animation */
  entranceIdx: number | undefined
}): ReactNode {
  const { t, lang, state, openDetail, runAction } = useHub()
  const move = useReducedMotionSafe(MOVE)
  const snap = useReducedMotionSafe(SNAP)
  const cardRef = useRef<HTMLDivElement>(null)
  const inView = useInView(cardRef)

  const isError = event.type === 'mod_removed' || event.type === 'mod_banned'
  const isDownloaded = event.type === 'downloaded'

  // Money moment: SSE/fs.watch-driven pending -> fetched transition on the mod.
  const modState: ModState =
    event.type === 'mod_removed'
      ? 'removed'
      : event.type === 'mod_banned'
        ? 'banned'
        : isDownloaded
          ? 'up-to-date'
          : (mod?.state ?? 'awaiting-steam')
  const mm = useMoneyMoment(modState)

  // STAMP thunk mounts 120ms after the card's layout insert settles.
  const [stampReady, setStampReady] = useState(!fresh)
  useEffect(() => {
    if (stampReady) return
    const timer = setTimeout(() => setStampReady(true), PUNCH_DELAY_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const stampState: StampState = isError
    ? event.type === 'mod_removed'
      ? 'removed'
      : 'banned'
    : isDownloaded
      ? 'fetched'
      : mm.celebrating && !mm.stampFlipped
        ? 'awaiting'
        : STAMP_BY_STATE[modState]
  const stampTs =
    stampState === 'fetched'
      ? (mod?.acfTs ?? event.detectedAt)
      : stampState === 'orphaned'
        ? mod?.accountAsOf
        : undefined

  const spineState = isError ? 'error' : isDownloaded ? 'fetched' : mm.spineState

  const title = mod?.title ?? event.title
  const previewUrl = mod?.previewUrl ?? event.previewUrl
  const steamRunning = state?.steamRunning ?? false
  const canForce = !isError && mod !== undefined && mod.source === 'workshop'

  // Entrance: route-entry stagger (first 5 only) or live-insert glide; else none.
  let entranceInitial: false | { opacity: number; y: number } = false
  let entranceTransition: Transition | undefined
  if (entranceIdx !== undefined) {
    entranceInitial = { opacity: 0, y: 4 }
    entranceTransition = { duration: 0.14, ease: 'easeOut', delay: entranceIdx * 0.04 }
  } else if (fresh) {
    entranceInitial = { opacity: 0, y: -6 }
    entranceTransition = move
  }

  return (
    <motion.article
      ref={cardRef}
      layout
      whileTap={{ scale: 0.985 }}
      initial={entranceInitial}
      animate={{ opacity: 1, y: 0, transition: entranceTransition ?? move }}
      transition={move}
      className={`card group relative overflow-hidden ${mm.ringing ? 'money-ring' : ''}`}
      data-event-type={event.type}
      data-seq={event.seq}
    >
      <Spine state={spineState} sweeping={mm.sweeping} />

      {/* Hero: 2.14:1, max 180px, dark scrim both themes; text always light-on-dark. */}
      <div className="relative">
        <ImageFrame
          src={previewUrl}
          appId={event.appId}
          gameName={gameName}
          title={title}
          aspect="2.14 / 1"
          maxHeight={180}
          scrim
          className="rounded-b-none border-0"
        >
          <Brackets show={!isError && mm.bracketsVisible} />
          <button
            type="button"
            onClick={() => openDetail(event.modId)}
            className="absolute inset-x-0 bottom-0 flex cursor-pointer flex-wrap items-end gap-x-[10px] gap-y-[4px] p-[14px] pr-[120px] text-left"
            title={title}
          >
            <span className="voice-title min-w-0 max-w-full truncate" style={{ color: '#E9EEF2' }}>
              {title}
            </span>
            <span className="flex items-center gap-[8px] pb-[1px]">
              <GamePill appId={event.appId} name={gameName} onArt />
              <span className="voice-mono-sm" style={{ color: 'rgba(233,238,242,0.64)' }}>
                {t('updates.updatedAt', { t: clockTime(event.ts) })}
              </span>
            </span>
          </button>
        </ImageFrame>
        {stampReady ? (
          <Stamp
            state={stampState}
            ts={stampTs}
            punch={fresh && event.type === 'update'}
            onArt
            className="absolute top-[8px] right-[8px] bg-[rgba(10,12,14,0.55)]"
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-[10px] py-[12px]">
        {/* 2-line changelog excerpt -> EXPAND to full entries (lazy, in-view gated). */}
        {!isError ? <ChangelogBlock modId={event.modId} active={inView} /> : null}

        {/* Mono footer: size · Δsize · subs · noticed — hover actions right. */}
        <div className="flex items-center gap-[12px] px-[16px]">
          <span className="voice-mono-sm flex min-w-0 items-center gap-[12px] text-[var(--text-3)] tabular">
            <span>{formatBytes(mod?.sizeWorkshop ?? mod?.sizeOnDisk)}</span>
            {event.sizeDelta ? (
              <span
                style={{
                  color:
                    event.sizeDelta > 0 ? 'var(--state-fetched)' : 'var(--state-error)',
                }}
              >
                {formatSizeDelta(event.sizeDelta)}
              </span>
            ) : null}
            {mod?.subs !== undefined ? <span>{formatCountCompact(mod.subs)} subs</span> : null}
            <span className="truncate">{t('updates.noticed', { t: relTime(lang, event.detectedAt) })}</span>
          </span>

          <span className="ml-auto flex shrink-0 items-center gap-[2px] opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
            {canForce ? (
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                transition={snap}
                disabled={!steamRunning}
                onClick={() => void runAction('download', { appId: event.appId, modId: event.modId })}
                title={steamRunning ? t('action.force') : t('misc.steamDown')}
                aria-label={t('action.force')}
                className="flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-std text-[var(--text-3)] hover:bg-[var(--bg-2)] hover:text-[var(--text-1)] disabled:pointer-events-none disabled:opacity-40"
              >
                <Download size={16} strokeWidth={1.75} />
              </motion.button>
            ) : null}
            <button
              type="button"
              onClick={() => openInSteam(event.modId)}
              title={t('action.openSteam')}
              aria-label={t('action.openSteam')}
              className="flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-std text-[var(--text-3)] hover:bg-[var(--bg-2)] hover:text-[var(--text-1)]"
            >
              <ExternalLink size={16} strokeWidth={1.75} />
            </button>
            <OverflowMenu modId={event.modId} />
          </span>
        </div>
      </div>
    </motion.article>
  )
}
