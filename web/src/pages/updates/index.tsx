// UPDATES home (DESIGN_SPEC §6.1/6.2): pinned LAUNCH QUEUE strip (at >=1400px
// a sticky right sidebar) over the 920px left-aligned mission-log column.
// Feed events come from the before_seq cursor API with SSE live inserts
// (MOVE glide + STAMP thunk handled inside FeedCard), day separators
// (condensed caps + double hairline), lazy changelog excerpts, and the
// force-download-all cascade: sequential action posts with chips flipping
// to DOWNLOADING top-to-bottom 120ms apart.
import { Radar } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../../api'
import { Button } from '../../components/Button'
import { Skeleton } from '../../components/Skeleton'
import { Spine } from '../../components/Spine'
import { DUR } from '../../motion'
import { useHub } from '../../store'
import type { FeedEvent, ModSummary } from '../../types'
import { dayLabel, formatBytes, isSameDay } from '../../util'
import { FeedCard } from './FeedCard'
import { useWide } from './hooks'
import {
  LaunchQueueSidebar,
  LaunchQueueStrip,
  type CascadeState,
  type QueueProps,
} from './LaunchQueue'
import { useFeed } from './useFeed'

/** Cascade pacing: chips flip top-to-bottom 120ms apart (DESIGN_SPEC §7). */
const CASCADE_STEP_MS = DUR.cascadeStep * 1000

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/* ---------- Day separator: condensed caps + double hairline ---------- */

function DaySeparator({ label }: { label: string }): ReactNode {
  return (
    <div className="flex items-center gap-[12px] pt-[6px]" role="separator" aria-label={label}>
      <span className="voice-label whitespace-nowrap">{label}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]" aria-hidden="true">
        <span className="block h-0 border-t border-[var(--line-div)]" />
        <span className="block h-0 border-t border-[var(--line-div)]" />
      </span>
    </div>
  )
}

/* ---------- Infinite scroll sentinel (before_seq pagination) ---------- */

function LoadMoreSentinel({ onHit, active }: { onHit: () => void; active: boolean }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      onHit()
      return
    }
    const obs = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) onHit()
      },
      { rootMargin: '480px' },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [onHit, active])
  return <div ref={ref} aria-hidden="true" className="h-px" />
}

/* ---------- First-load skeleton: mirrors the final card geometry ---------- */

function PageSkeleton(): ReactNode {
  return (
    <div className="flex flex-col gap-[14px]" aria-hidden="true">
      <div className="flex items-center gap-[8px] pb-[2px]">
        <Skeleton width={170} height={11} radius={2} />
        <Skeleton width={128} height={26} radius={4} className="ml-auto" />
      </div>
      {[0, 1, 2].map(i => (
        <div key={i} className="card overflow-hidden">
          <Skeleton height={150} radius={0} className="w-full" />
          <div className="flex flex-col gap-[8px] px-[16px] py-[12px]">
            <Skeleton width={`${68 - i * 9}%`} height={12} radius={2} />
            <Skeleton width="38%" height={10} radius={2} />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ---------- Page ---------- */

export default function UpdatesPage(): ReactNode {
  const { state, t, lang, toast, actions, runAction } = useHub()
  const feed = useFeed()
  const wide = useWide()

  const mods = useMemo(() => state?.mods ?? [], [state])
  const games = useMemo(() => state?.games ?? [], [state])
  const modById = useMemo(() => new Map(mods.map(m => [m.id, m])), [mods])
  const gameNameById = useMemo(() => new Map(games.map(g => [g.appId, g.name])), [games])
  const steamRunning = state?.steamRunning ?? false

  /** AWAITING STEAM queue, cascade order = display order (freshest update first). */
  const awaiting = useMemo(
    () =>
      mods
        .filter(m => m.state === 'awaiting-steam')
        .sort((a, b) => (b.remoteTs ?? 0) - (a.remoteTs ?? 0)),
    [mods],
  )

  /** RECEIVED TODAY mini-log: 'downloaded' events from today, newest first, last 5. */
  const received = useMemo<FeedEvent[]>(() => {
    const now = Math.floor(Date.now() / 1000)
    return feed.events
      .filter(e => e.type === 'downloaded' && isSameDay(e.detectedAt, now))
      .sort((a, b) => b.detectedAt - a.detectedAt)
      .slice(0, 5)
  }, [feed.events])

  /** Sidebar stat strip: "206 mods · 38.4 GB · 8 games". */
  const statLine = useMemo(() => {
    const totalBytes = mods.reduce((acc, m) => acc + (m.sizeOnDisk ?? m.sizeWorkshop ?? 0), 0)
    return t('library.totalsGames', {
      n: mods.length,
      s: formatBytes(totalBytes),
      g: games.length,
    })
  }, [mods, games, t])

  /* ----- force-download: local chip flips + the update-all cascade ----- */

  const [flipped, setFlipped] = useState<ReadonlySet<string>>(new Set())
  const [cascade, setCascade] = useState<CascadeState | null>(null)
  const cascadingRef = useRef(false)
  const aliveRef = useRef(true)
  /** ids whose POST has not settled yet — the prune effect must not touch them */
  const pendingPost = useRef<Set<string>>(new Set())

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  /** Flip the chip to DOWNLOADING, post the action; revert on refusal. */
  const forceMod = useCallback(
    async (mod: ModSummary): Promise<string | null> => {
      pendingPost.current.add(mod.id)
      setFlipped(prev => new Set(prev).add(mod.id))
      try {
        const actionId = await runAction('download', { appId: mod.appId, modId: mod.id })
        if (actionId === null && aliveRef.current) {
          setFlipped(prev => {
            const next = new Set(prev)
            next.delete(mod.id)
            return next
          })
        }
        return actionId
      } finally {
        pendingPost.current.delete(mod.id)
      }
    },
    [runAction],
  )

  const onForceOne = useCallback(
    (mod: ModSummary) => {
      void forceMod(mod)
    },
    [forceMod],
  )

  /** The update-all cascade: strictly sequential posts, flips 120ms apart. */
  const onForceAll = useCallback(() => {
    if (cascadingRef.current) return
    const targets = awaiting.filter(m => !flipped.has(m.id))
    if (targets.length === 0) return
    cascadingRef.current = true
    setCascade({ done: 0, total: targets.length })
    void (async () => {
      let done = 0
      for (const mod of targets) {
        if (!aliveRef.current) break
        const actionId = await forceMod(mod)
        if (actionId === null) break // refused (Steam down / server error) — stop the run
        done += 1
        if (aliveRef.current) setCascade({ done, total: targets.length })
        await sleep(CASCADE_STEP_MS)
      }
      if (aliveRef.current) {
        await sleep(500) // let the pill show n/n before morphing back
        if (aliveRef.current) setCascade(null)
      }
      cascadingRef.current = false
    })()
  }, [awaiting, flipped, forceMod])

  // Reconcile local flips against reality: a chip stays DOWNLOADING while its
  // action is live or once the mod's server state moved on; a still-awaiting
  // mod with no live action (failed / expired) reverts to the breathing dot.
  useEffect(() => {
    setFlipped(prev => {
      if (prev.size === 0) return prev
      const next = new Set(prev)
      for (const id of prev) {
        if (pendingPost.current.has(id)) continue
        const mod = modById.get(id)
        if (!mod) {
          next.delete(id)
          continue
        }
        if (mod.state !== 'awaiting-steam') continue // left the queue — flip is moot
        const inFlight = Object.values(actions).some(
          a => (a.modId === id || (a.modIds?.includes(id) ?? false)) && a.endedAt === undefined,
        )
        if (!inFlight && !cascadingRef.current) next.delete(id)
      }
      return next.size === prev.size ? prev : next
    })
  }, [actions, modById])

  const queueProps: QueueProps = {
    awaiting,
    received,
    flipped,
    cascade,
    onForceAll,
    onForceOne,
    steamRunning,
    statLine,
  }

  /* ----- empty-feed amber action ----- */

  const pollMinutes = Math.max(1, Math.round((state?.settings?.pollIntervalSec ?? 300) / 60))
  const checkNow = useCallback(() => {
    void api
      .checkNow()
      .catch((e: unknown) => toast('error', t('toast.actionFailed', { e: String(e) })))
  }, [t, toast])

  /* ----- mission log body ----- */

  let feedBody: ReactNode
  if (!state || !feed.loaded) {
    feedBody = <PageSkeleton />
  } else if (feed.failed) {
    feedBody = (
      <div className="card relative flex items-center gap-[12px] overflow-hidden px-[16px] py-[14px]">
        <Spine state="error" />
        <span className="text-[13px] text-[var(--text-2)]">{t('updates.feedError')}</span>
        <Button variant="secondary" className="ml-auto shrink-0" onClick={feed.retry}>
          {t('updates.retry')}
        </Button>
      </div>
    )
  } else if (feed.events.length === 0) {
    feedBody = (
      <div className="flex flex-col items-center gap-[10px] py-[64px] text-center">
        <Radar size={28} strokeWidth={1.75} className="text-[var(--text-3)]" aria-hidden="true" />
        <p className="max-w-[420px] text-[13px] text-[var(--text-2)]">
          {t('updates.emptyFeed', { n: pollMinutes })}
        </p>
        <button
          type="button"
          onClick={checkNow}
          className="cursor-pointer text-[13px] font-medium text-[var(--accent-text)] hover:underline"
        >
          {t('action.checkNow')}
        </button>
      </div>
    )
  } else {
    const rows: ReactNode[] = []
    let lastDayTs: number | null = null
    for (const event of feed.events) {
      if (lastDayTs === null || !isSameDay(event.ts, lastDayTs)) {
        rows.push(<DaySeparator key={`day-${event.seq}`} label={dayLabel(lang, event.ts)} />)
        lastDayTs = event.ts
      }
      rows.push(
        <FeedCard
          key={event.seq}
          event={event}
          mod={modById.get(event.modId)}
          gameName={gameNameById.get(event.appId)}
          fresh={feed.freshSeqs.has(event.seq)}
          entranceIdx={feed.entranceIndex.get(event.seq)}
        />,
      )
    }
    feedBody = (
      <>
        <div className="flex flex-col gap-[14px]">{rows}</div>
        <LoadMoreSentinel
          onHit={feed.loadOlder}
          active={feed.hasMore && !feed.loadingMore && !feed.failed}
        />
        {feed.loadingMore ? (
          <div className="voice-mono-sm py-[14px] text-center text-[var(--text-3)]">
            {t('misc.loading')}
          </div>
        ) : null}
      </>
    )
  }

  /* ----- frame: 920px log column, left-aligned; >=1400px sidebar variant ----- */

  return (
    <div className="px-[24px] pb-[32px]">
      <div className={wide ? 'flex items-start gap-[24px] pt-[16px]' : ''}>
        <div className="w-full max-w-[920px] min-w-0">
          {!wide ? <LaunchQueueStrip {...queueProps} /> : null}
          <section className={wide ? '' : 'pt-[16px]'}>
            <div className="voice-label pb-[10px]">{t('updates.missionLog')}</div>
            {feedBody}
          </section>
        </div>
        {wide ? <LaunchQueueSidebar {...queueProps} /> : null}
      </div>
    </div>
  )
}
