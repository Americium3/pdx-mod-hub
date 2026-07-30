// DETAIL SHEET content (DESIGN_SPEC §6): 560px right sheet over any page.
// Loads GET /api/mods/:id on open (skeleton meanwhile); hero 3.4:1 with scrim
// title + GamePill + Stamp; Steam-mirroring stats block; sanitized description
// and cursor-paginated changelog tabs; 202-job action row with SSE stage line.
import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronRight,
  Copy,
  Download,
  ExternalLink,
  Globe,
  Play,
  Plus,
  Star,
  TriangleAlert,
} from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, img } from '../api'
import { Button } from '../components/Button'
import { DetailSheetShell } from '../components/DetailSheetShell'
import { GamePill, TargetsPill } from '../components/GamePill'
import { ImageFrame } from '../components/ImageFrame'
import { InlineConfirm } from '../components/InlineConfirm'
import { ReservedText } from '../components/ReservedText'
import { Skeleton } from '../components/Skeleton'
import { Stamp } from '../components/Stamp'
import { StateDot } from '../components/StateDot'
import type { MsgKey } from '../i18n'
import { DUR, SNAP, useReducedMotionSafe } from '../motion'
import { useHub } from '../store'
import type { ActionProgress, ActionStage, ModDetail, ModState } from '../types'
import { TERMINAL_STAGES } from '../types'
import { absDate, absDateTime, formatBytes, formatCountExact } from '../util'
import { ChangelogTab } from './Changelog'
import {
  normalizeDetail,
  profileUrlOf,
  PROSE_CLASS,
  safeCssColor,
  stampStateOf,
  steamPageUrl,
  steamRunUrl,
  workshopPageUrl,
} from './model'

/** account.subscribed == true for these derived states (API_AMENDMENTS). */
const SUBSCRIBED_STATES: readonly ModState[] = [
  'awaiting-steam',
  'queued-for-launch',
  'downloading',
  'up-to-date',
  'not-installed',
]

export default function DetailSheet({
  modId,
  onClose,
}: {
  modId: string | null
  onClose: () => void
}): ReactNode {
  const { state } = useHub()
  const summary = modId ? state?.mods.find(m => m.id === modId) : undefined
  return (
    <DetailSheetShell open={modId !== null} onClose={onClose} title={summary?.title}>
      {modId ? <DetailContent key={modId} modId={modId} /> : null}
    </DetailSheetShell>
  )
}

/* ================= Content (remounts per mod via key) ================= */

function DetailContent({ modId }: { modId: string }): ReactNode {
  const { state, t, lang, actions, runAction, toast } = useHub()
  const snap = useReducedMotionSafe(SNAP)

  const summary = state?.mods.find(m => m.id === modId)
  const summaryState = summary?.state

  const [detail, setDetail] = useState<ModDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'description' | 'changelog'>('description')

  // Fetch full record on open; refetch when the summary state flips (SSE/poll)
  // without clearing what is already on screen.
  useEffect(() => {
    let alive = true
    setLoading(true)
    api
      .mod(modId)
      .then(d => {
        if (!alive) return
        setDetail(d)
        setLoadError(null)
        setLoading(false)
      })
      .catch((e: unknown) => {
        if (!alive) return
        setLoadError(e instanceof Error ? e.message : String(e))
        setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [modId, summaryState])

  const n = useMemo(() => (detail ? normalizeDetail(detail) : undefined), [detail])

  /* ----- merged view (summary is fresher for state; detail is richer) ----- */
  const appId = summary?.appId ?? n?.appId
  const title = n?.title ?? summary?.title ?? modId
  const stateVal: ModState | undefined = summaryState ?? n?.state
  const source = n?.source ?? summary?.source ?? 'workshop'
  const previewUrl = n?.previewUrl ?? summary?.previewUrl
  const remoteTs = n?.remoteTs ?? summary?.remoteTs
  const acfTs = n?.acfTs ?? summary?.acfTs
  const sizeWorkshop = n?.sizeWorkshop ?? summary?.sizeWorkshop
  const sizeOnDisk = n?.sizeOnDisk ?? summary?.sizeOnDisk
  const subs = n?.subs ?? summary?.subs
  const branchRange = n?.branchRange ?? summary?.branchRange ?? undefined
  const accountAsOf = summary?.accountAsOf ?? n?.accountAsOf
  const washColor = safeCssColor(summary?.dominantColor ?? n?.dominantColor)

  const stamp = stateVal ? stampStateOf(stateVal) : null
  const stampTs = stamp === 'fetched' ? acfTs : stamp === 'orphaned' ? accountAsOf : undefined

  /* ----- in-flight action for this mod (SSE stage line) ----- */
  const activeAction = useMemo(() => {
    const mine = Object.values(actions).filter(
      a => a.modId === modId || (a.modIds?.includes(modId) ?? false),
    )
    mine.sort((a, b) => b.startedAt - a.startedAt)
    return mine[0]
  }, [actions, modId])
  const busy = activeAction !== undefined && !TERMINAL_STAGES.includes(activeAction.stage)

  const steamRunning = state?.steamRunning ?? false
  const isWorkshop = source === 'workshop'
  const gone = stateVal === 'removed' || stateVal === 'banned'
  const subscribed = stateVal !== undefined && SUBSCRIBED_STATES.includes(stateVal)
  const showSubscribe =
    isWorkshop && !gone && (stateVal === 'orphaned' || stateVal === 'unverified')
  const showUnsubscribe = isWorkshop && subscribed
  const showForce = isWorkshop && !gone

  const copyId = (): void => {
    void navigator.clipboard.writeText(modId).then(
      () => toast('success', t('toast.copied', { t: modId })),
      () => toast('error', t('toast.actionFailed', { e: 'clipboard' })),
    )
  }

  /* ----- full skeleton only when we know nothing at all ----- */
  if (!summary && !detail && !loadError) {
    return (
      <div className="flex flex-col gap-[14px] p-[16px]" aria-hidden="true">
        <Skeleton height={155} />
        <Skeleton height={16} width="60%" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} height={12} width={`${88 - i * 6}%`} radius={2} />
        ))}
      </div>
    )
  }

  const authorId = n?.author
  const authorHref = profileUrlOf(authorId, n?.authorUrl)
  const avatar = img(n?.authorAvatarUrl)

  return (
    <div className="flex min-h-full flex-col">
      {/* ----- hero: 3.4:1, dominant-color wash, scrim title + pill + stamp ----- */}
      <div className="relative px-[16px] pt-[16px]">
        {washColor ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-[220px]"
            style={{
              background: `radial-gradient(130% 140% at 50% 0%, color-mix(in srgb, ${washColor} 20%, transparent), transparent 72%)`,
            }}
          />
        ) : null}
        <ImageFrame
          src={previewUrl}
          appId={appId ?? 0}
          title={title}
          aspect="3.4 / 1"
          scrim
          className="relative"
        >
          <div className="flex h-full flex-col justify-between p-[12px]">
            <div className="flex justify-end">
              {stamp ? <Stamp state={stamp} ts={stampTs} /> : null}
            </div>
            <div className="flex items-end justify-between gap-[10px]">
              {/* Text over art is always light-on-dark in both themes. */}
              <span className="voice-title line-clamp-2 min-w-0" style={{ color: '#E9EEF2' }}>
                {title}
              </span>
              {appId !== undefined ? <GamePill appId={appId} className="mb-[2px] shrink-0" /> : null}
            </div>
          </div>
        </ImageFrame>
      </div>

      <div className="flex flex-col gap-[16px] px-[16px] pt-[14px] pb-[16px]">
        {/* ----- banners ----- */}
        {stateVal === 'banned' ? (
          <ErrorBanner>{t('detail.bannedBanner')}</ErrorBanner>
        ) : stateVal === 'removed' ? (
          <ErrorBanner>{t('detail.removedBanner')}</ErrorBanner>
        ) : null}
        {loadError ? <ErrorBanner>{t('detail.loadFailed', { e: loadError })}</ErrorBanner> : null}

        {/* States with no hero stamp still get the plain dot + label. */}
        {stamp === null && stateVal !== undefined ? <StateDot state={stateVal} /> : null}

        {/* ----- stats block mirroring Steam (mono, right-aligned) ----- */}
        <section className="flex flex-col">
          {n && (n.score !== undefined || n.voteCount !== undefined) ? (
            <StatRow label={t('meta.rating')}>
              {(n.voteCount ?? 0) < 10 ? (
                <span className="text-[var(--text-3)]">{t('browse.notEnoughRatings')}</span>
              ) : (
                <span className="inline-flex items-center gap-[6px]">
                  {n.score !== undefined ? <Stars score={n.score} /> : null}
                  <span>({formatCountExact(n.voteCount)})</span>
                </span>
              )}
            </StatRow>
          ) : null}
          <StatRow label={t('meta.posted')}>{absDate(lang, n?.timeCreated)}</StatRow>
          <StatRow label={t('meta.updatedRemote')}>{absDateTime(lang, remoteTs)}</StatRow>
          <StatRow label={t('meta.updatedLocal')}>{absDateTime(lang, acfTs)}</StatRow>
          <StatRow label={t('meta.size')}>{formatBytes(sizeWorkshop)}</StatRow>
          <StatRow label={t('meta.sizeOnDisk')}>{formatBytes(sizeOnDisk)}</StatRow>
          <StatRow label={t('meta.subscribers')}>{formatCountExact(subs)}</StatRow>
          <StatRow label={t('meta.favorites')}>{formatCountExact(n?.favorites)}</StatRow>
          <StatRow label={t('meta.views')}>{formatCountExact(n?.views)}</StatRow>
          <StatRow label={t('meta.author')}>
            <span className="inline-flex min-w-0 items-center gap-[6px]">
              {avatar ? (
                <img src={avatar} alt="" className="h-[16px] w-[16px] shrink-0 rounded-chip" />
              ) : null}
              {authorHref ? (
                <a
                  href={authorHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="truncate font-mono"
                >
                  {authorId ?? authorHref}
                </a>
              ) : (
                <span className="truncate">{authorId ?? '—'}</span>
              )}
            </span>
          </StatRow>
          <StatRow label={t('detail.modId')}>{modId}</StatRow>
          {branchRange ? (
            <StatRow label={t('library.col.targets')}>
              <TargetsPill min={branchRange.min} max={branchRange.max} />
            </StatRow>
          ) : null}
        </section>

        {/* ----- tags: bordered pills ----- */}
        {n && n.tags.length > 0 ? (
          <section>
            <div className="voice-label mb-[6px]">{t('meta.tags')}</div>
            <div className="flex flex-wrap gap-[6px]">
              {n.tags.map(tag => (
                <span
                  key={tag}
                  className="rounded-chip border border-[var(--line-2)] px-[6px] py-[1px] font-mono text-[11px] leading-[16px] text-[var(--text-2)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {/* ----- dependencies both directions + required DLC ----- */}
        {n && (n.children.length > 0 || n.requiredBy.length > 0 || n.dlcRequired.length > 0) ? (
          <section className="flex flex-col gap-[12px]">
            {n.children.length > 0 ? (
              <DepList labelKey="meta.dependencies" ids={n.children} />
            ) : null}
            {n.requiredBy.length > 0 ? (
              <DepList labelKey="meta.requiredBy" ids={n.requiredBy} />
            ) : null}
            {n.dlcRequired.length > 0 ? (
              <div>
                <div className="voice-label mb-[6px]">{t('meta.dlc')}</div>
                <div className="rounded-std border border-[var(--line-1)]">
                  {n.dlcRequired.map(d => (
                    <div
                      key={d.appId}
                      className="flex items-center justify-between gap-[8px] border-b border-[var(--line-div)] px-[8px] py-[5px] text-[13px] last:border-b-0"
                    >
                      <span className="min-w-0 truncate">{d.name ?? `DLC ${d.appId}`}</span>
                      <span className="shrink-0 font-mono text-[11px] text-[var(--text-3)] tabular">
                        {d.appId}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {/* ----- description / changelog tabs ----- */}
        <section>
          <div className="flex gap-[16px] border-b border-[var(--line-div)]">
            {(['description', 'changelog'] as const).map(id => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className="voice-label relative cursor-pointer pb-[6px]"
                style={id === tab ? { color: 'var(--accent-text)' } : undefined}
              >
                {id === 'description' ? t('detail.tab.description') : t('updates.changelog')}
                {id === tab ? (
                  <motion.span
                    layoutId="pmh-detail-tab"
                    transition={snap}
                    className="absolute right-0 -bottom-[1px] left-0 h-[2px] bg-[var(--accent-graphic)]"
                  />
                ) : null}
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: DUR.stampSwap }}
            >
              {tab === 'description' ? (
                n?.descriptionHtml ? (
                  // Server-sanitized BBCode -> HTML (API_AMENDMENTS security posture).
                  <div
                    className={`${PROSE_CLASS} pt-[10px]`}
                    dangerouslySetInnerHTML={{ __html: n.descriptionHtml }}
                  />
                ) : n?.descriptionText ? (
                  // Unsanitized raw text from the stage-A server: plain text only.
                  <div className={`${PROSE_CLASS} pt-[10px] whitespace-pre-wrap`}>
                    {n.descriptionText}
                  </div>
                ) : loading ? (
                  <div className="flex flex-col gap-[8px] pt-[12px]" aria-hidden="true">
                    <Skeleton height={10} width="92%" radius={2} />
                    <Skeleton height={10} width="84%" radius={2} />
                    <Skeleton height={10} width="70%" radius={2} />
                  </div>
                ) : (
                  <p className="pt-[10px] text-[13px] text-[var(--text-3)] italic">
                    {t('detail.noDescription')}
                  </p>
                )
              ) : (
                <ChangelogTab modId={modId} />
              )}
            </motion.div>
          </AnimatePresence>
        </section>
      </div>

      {/* ----- action row: 202 jobs + SSE stage line (sticky) ----- */}
      <div className="sticky bottom-0 z-10 mt-auto flex flex-col gap-[8px] border-t border-[var(--line-div)] bg-[var(--bg-1)] px-[16px] py-[12px]">
        {activeAction ? <StageLine action={activeAction} /> : null}
        <div className="flex flex-wrap items-center gap-[8px]">
          {showSubscribe ? (
            <Button
              variant="primary"
              disabled={!steamRunning || busy || appId === undefined}
              title={!steamRunning ? t('misc.steamDown') : t('action.subscribe')}
              onClick={() => {
                if (appId !== undefined) void runAction('subscribe', { appId, modId })
              }}
            >
              <Plus size={16} strokeWidth={1.75} />
              <ReservedText k="action.subscribe" center />
            </Button>
          ) : null}
          {showUnsubscribe ? (
            <InlineConfirm
              labelKey="action.unsubscribe"
              confirmKey="confirm.unsubscribe"
              disabled={!steamRunning || busy || appId === undefined}
              onConfirm={() => {
                if (appId !== undefined) void runAction('unsubscribe', { appId, modId })
              }}
            />
          ) : null}
          {showForce ? (
            <Button
              variant="secondary"
              disabled={!steamRunning || busy || appId === undefined}
              title={!steamRunning ? t('misc.steamDown') : t('action.force')}
              onClick={() => {
                if (appId !== undefined) void runAction('download', { appId, modId })
              }}
            >
              <Download size={16} strokeWidth={1.75} />
              <ReservedText k="action.force" center />
            </Button>
          ) : null}
          {isWorkshop ? (
            <Button
              variant="ghost"
              title={t('action.openSteam')}
              onClick={() => window.location.assign(steamPageUrl(modId))}
            >
              <ExternalLink size={16} strokeWidth={1.75} />
              <ReservedText k="action.openSteam" center />
            </Button>
          ) : null}
          {isWorkshop ? (
            <Button
              variant="ghost"
              title={t('action.openBrowser')}
              onClick={() => window.open(workshopPageUrl(modId), '_blank', 'noopener,noreferrer')}
            >
              <Globe size={16} strokeWidth={1.75} />
              <ReservedText k="action.openBrowser" center />
            </Button>
          ) : null}
          <Button variant="ghost" title={t('action.copyId')} onClick={copyId}>
            <Copy size={16} strokeWidth={1.75} />
            <ReservedText k="action.copyId" center />
          </Button>
          <Button
            variant="ghost"
            disabled={appId === undefined}
            title={t('action.launchGame')}
            onClick={() => {
              if (appId !== undefined) window.location.assign(steamRunUrl(appId))
            }}
          >
            <Play size={16} strokeWidth={1.75} />
            <ReservedText k="action.launchGame" center />
          </Button>
        </div>
      </div>
    </div>
  )
}

/* ================= Pieces ================= */

/** Mono right-aligned label row (stats block). */
function StatRow({ label, children }: { label: ReactNode; children: ReactNode }): ReactNode {
  return (
    <div className="flex items-center justify-between gap-[12px] border-b border-[var(--line-div)] py-[6px] last:border-b-0">
      <span className="voice-label shrink-0">{label}</span>
      <span className="voice-mono min-w-0 text-right text-[var(--text-1)]">{children}</span>
    </div>
  )
}

/** Steam-style 5-star readout from score 0..1. */
function Stars({ score }: { score: number }): ReactNode {
  const filled = Math.round(Math.max(0, Math.min(1, score)) * 5)
  return (
    <span className="inline-flex items-center gap-[2px]" aria-label={`${filled}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          size={12}
          strokeWidth={1.75}
          style={{
            color: i < filled ? 'var(--accent-text)' : 'var(--text-3)',
            fill: i < filled ? 'var(--accent-text)' : 'none',
          }}
        />
      ))}
    </span>
  )
}

function ErrorBanner({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="flex items-start gap-[8px] rounded-std border border-[var(--state-error)] bg-[color-mix(in_srgb,var(--state-error)_8%,transparent)] px-[10px] py-[8px] text-[13px] text-[var(--state-error)]">
      <TriangleAlert size={16} strokeWidth={1.75} className="mt-[2px] shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  )
}

/** Requires / required-by lists cross-referenced against the local cache. */
function DepList({ labelKey, ids }: { labelKey: MsgKey; ids: string[] }): ReactNode {
  const { t } = useHub()
  return (
    <div>
      <div className="voice-label mb-[6px]">{t(labelKey)}</div>
      <div className="flex flex-col gap-[4px]">
        {ids.map(id => (
          <DepRow key={id} id={id} />
        ))}
      </div>
    </div>
  )
}

function DepRow({ id }: { id: string }): ReactNode {
  const { state, t, openDetail } = useHub()
  const dep = state?.mods.find(m => m.id === id)
  if (!dep) {
    // Not in the local cache = not subscribed/installed -> --state-error row.
    return (
      <a
        href={workshopPageUrl(id)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-[8px] rounded-std border border-[var(--state-error)] px-[8px] py-[5px] text-[13px] !text-[var(--state-error)] hover:bg-[color-mix(in_srgb,var(--state-error)_8%,transparent)] hover:!no-underline"
      >
        <TriangleAlert size={16} strokeWidth={1.75} className="shrink-0" />
        <span>{t('meta.missingDep')}</span>
        <span className="ml-auto shrink-0 font-mono text-[11px] tabular">{id}</span>
      </a>
    )
  }
  return (
    <button
      type="button"
      onClick={() => openDetail(id)}
      className="flex w-full cursor-pointer items-center gap-[8px] rounded-std border border-[var(--line-1)] px-[8px] py-[5px] text-left text-[13px] text-[var(--text-1)] hover:bg-[var(--bg-2)]"
    >
      <StateDot state={dep.state} label={false} />
      <span className="min-w-0 truncate">{dep.title}</span>
      <ChevronRight size={14} strokeWidth={1.75} className="ml-auto shrink-0 text-[var(--text-3)]" />
    </button>
  )
}

function stageColor(stage: ActionStage): string {
  switch (stage) {
    case 'failed':
      return 'var(--state-error)'
    case 'acf_confirmed':
      return 'var(--state-fetched)'
    case 'downloading':
      return 'var(--state-downloading)'
    case 'result_ok_unconfirmed':
      return 'var(--state-orphaned)'
    default:
      return 'var(--accent-text)'
  }
}

/** Small mono status line reflecting SSE action stages. */
function StageLine({ action }: { action: ActionProgress }): ReactNode {
  const { t } = useHub()
  const color = stageColor(action.stage)
  const terminal = TERMINAL_STAGES.includes(action.stage)
  return (
    <div className="voice-mono-sm flex min-w-0 items-center gap-[6px]" style={{ color }}>
      <span
        className={`inline-block h-[6px] w-[6px] shrink-0 rounded-full ${terminal ? '' : 'dot-breathe'}`}
        style={{ background: color }}
      />
      <span className="shrink-0">{t(`stage.${action.stage}` as MsgKey)}</span>
      {action.queuePosition !== undefined && action.queuePosition > 0 ? (
        <span className="shrink-0 text-[var(--text-3)]">
          {t('action.queuePosition', { n: action.queuePosition })}
        </span>
      ) : null}
      {action.detail ? (
        <span className="min-w-0 truncate text-[var(--text-3)]">{action.detail}</span>
      ) : null}
    </div>
  )
}
