// BROWSE (DESIGN_SPEC §6) — 1080px column.
// Game tab bar (heraldic underline via layoutId, rail scope preselects) over a
// toolbar (Enter-to-search with auto-relevance · sort tabs mapped to the server
// enum with a trend-window dropdown · mono results readout · persisted
// rows ⇄ poster-grid toggle). Results come from POST /api/browse/:appId; the
// Subscribe control is state-aware and settles on SSE action stages.
// Rows NEVER animate on initial render.
import { motion } from 'framer-motion'
import { Info, LayoutGrid, List, Search, Star } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react'
import { Button } from '../../components/Button'
import { GameGlyph } from '../../components/GamePill'
import { img } from '../../api'
import { GridCell, GridRow, GridTable } from '../../components/GridTable'
import { ImageFrame } from '../../components/ImageFrame'
import { Input } from '../../components/Input'
import { ReservedText } from '../../components/ReservedText'
import { Skeleton, SkeletonRows } from '../../components/Skeleton'
import { SNAP, useReducedMotionSafe } from '../../motion'
import { useHub } from '../../store'
import type { BrowseItem, BrowseSort, GameInfo } from '../../types'
import {
  absDateTime,
  formatCountCompact,
  formatCountExact,
  gameColor,
  relTime,
} from '../../util'
import {
  RequiredItemsDialog,
  SubscribeControl,
  useSubscriptions,
  type SubscriptionsApi,
} from './subscribe'
import { useBrowse } from './useBrowse'

/* ------------------------------------------------------------ constants */

const VIEW_KEY = 'pmh.browse.view'
const NOTICE_KEY = 'pmh.browse.helperNotice'

type ViewMode = 'rows' | 'grid'
type SortTab = 'relevance' | 'popular' | 'updated' | 'published'
type TrendWindow = '7d' | '30d' | 'all'

/** Dense media rows: 112x52 identity · rating · subs · updated · Subscribe. */
const ROW_COLUMNS = 'minmax(320px,1fr) 150px 100px 120px 190px'

const SELECT_CLASS =
  'h-[28px] cursor-pointer rounded-std border border-[var(--line-2)] bg-[var(--inset)] ' +
  'px-[8px] font-ui text-[12px] text-[var(--text-1)] outline-none'

function browserPageUrl(id: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`
}

function browsable(game: GameInfo): boolean {
  return game.browsable !== false
}

/* ------------------------------------------------------------ small parts */

/** Star rating from the server score (0..1) + vote count; honest under ~10. */
function StarRating({ score, count }: { score?: number; count?: number }): ReactNode {
  const { t } = useHub()
  if (score === undefined || count === undefined || count < 10) {
    return (
      <span className="text-[11px] whitespace-nowrap text-[var(--text-3)]">
        {t('browse.notEnoughRatings')}
      </span>
    )
  }
  const filled = Math.round(Math.max(0, Math.min(1, score)) * 5)
  return (
    <span
      className="inline-flex items-center gap-[5px]"
      title={`${(Math.max(0, Math.min(1, score)) * 5).toFixed(1)} / 5`}
    >
      <span className="inline-flex items-center gap-[1px]">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            size={12}
            strokeWidth={1.75}
            fill={i < filled ? 'currentColor' : 'none'}
            className={i < filled ? 'text-[var(--accent-text)]' : 'text-[var(--text-3)]'}
          />
        ))}
      </span>
      <span className="voice-mono-sm tabular text-[var(--text-3)]">
        {formatCountCompact(count)}
      </span>
    </span>
  )
}

/** Corner tag for banned results; onArt gets a dark backing over Steam art. */
function BannedTag({ onArt = false }: { onArt?: boolean }): ReactNode {
  const { t } = useHub()
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-chip border px-[4px] font-mono text-[10px] leading-[14px] tracking-[0.08em] uppercase"
      style={
        onArt
          ? { borderColor: '#e0564f', color: '#e0564f', background: 'rgba(10, 12, 14, 0.72)' }
          : { borderColor: 'var(--state-error)', color: 'var(--state-error)' }
      }
    >
      {t('stamp.banned')}
    </span>
  )
}

/** Bordered tag chips, max 3 + "+n" overflow. */
function TagChips({ tags }: { tags?: string[] }): ReactNode {
  if (!tags || tags.length === 0) return null
  const shown = tags.slice(0, 3)
  const extra = tags.length - shown.length
  return (
    <span className="flex min-w-0 items-center gap-[4px] overflow-hidden">
      {shown.map(tag => (
        <span
          key={tag}
          className="shrink-0 rounded-chip border border-[var(--line-2)] px-[4px] font-mono text-[10px] leading-[14px] whitespace-nowrap text-[var(--text-3)]"
        >
          {tag}
        </span>
      ))}
      {extra > 0 ? <span className="voice-mono-sm shrink-0 text-[var(--text-3)]">+{extra}</span> : null}
    </span>
  )
}

/* ------------------------------------------------------------ game tabs */

function GameTabs({
  games,
  selectedAppId,
  onSelect,
}: {
  games: GameInfo[]
  selectedAppId: number | null
  onSelect: (appId: number) => void
}): ReactNode {
  const snap = useReducedMotionSafe(SNAP)
  return (
    <div
      className="flex items-end gap-[2px] overflow-x-auto border-b border-[var(--line-1)]"
      role="tablist"
    >
      {games.map(game => {
        const active = game.appId === selectedAppId
        const dim = !browsable(game)
        return (
          <button
            key={game.appId}
            type="button"
            role="tab"
            aria-selected={active}
            title={game.name}
            onClick={() => onSelect(game.appId)}
            className={`relative flex h-[36px] shrink-0 cursor-pointer items-center gap-[7px] px-[12px] text-[13px] whitespace-nowrap select-none ${
              active
                ? 'font-medium text-[var(--text-1)]'
                : dim
                  ? 'text-[var(--text-3)] hover:text-[var(--text-2)]'
                  : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
            }`}
          >
            <GameGlyph appId={game.appId} name={game.name} size={14} />
            {game.name}
            {active ? (
              <motion.span
                layoutId="browse-tab-underline"
                transition={snap}
                className="absolute right-[4px] bottom-[-1px] left-[4px] h-[2px]"
                style={{ background: gameColor(game.appId, game.name) }}
              />
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------ toolbar */

function SortTabs({
  tab,
  hasQuery,
  onSelect,
}: {
  tab: SortTab
  hasQuery: boolean
  onSelect: (tab: SortTab) => void
}): ReactNode {
  const snap = useReducedMotionSafe(SNAP)
  const tabs: SortTab[] = hasQuery
    ? ['relevance', 'popular', 'updated', 'published']
    : ['popular', 'updated', 'published']
  return (
    <div
      className="flex h-[28px] shrink-0 items-center rounded-std border border-[var(--line-1)]"
      role="radiogroup"
    >
      {tabs.map(key => {
        const active = tab === key
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onSelect(key)}
            className={`relative flex h-[28px] cursor-pointer items-center px-[10px] text-[12px] select-none ${
              active ? 'text-[var(--accent-text)]' : 'text-[var(--text-2)] hover:text-[var(--text-1)]'
            }`}
          >
            {active ? (
              <motion.span
                layoutId="browse-sort-pill"
                transition={snap}
                className="absolute inset-[2px] rounded-chip bg-[var(--accent-tint)]"
              />
            ) : null}
            <span className="relative">
              <ReservedText
                k={
                  key === 'relevance'
                    ? 'browse.sort.relevance'
                    : key === 'popular'
                      ? 'browse.sort.popular'
                      : key === 'updated'
                        ? 'browse.sort.updated'
                        : 'browse.sort.published'
                }
                center
              />
            </span>
          </button>
        )
      })}
    </div>
  )
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode
  onChange: (view: ViewMode) => void
}): ReactNode {
  const { t } = useHub()
  const snap = useReducedMotionSafe(SNAP)
  const segments: { mode: ViewMode; icon: ReactNode; label: string }[] = [
    { mode: 'rows', icon: <List size={16} strokeWidth={1.75} />, label: t('browse.viewRows') },
    { mode: 'grid', icon: <LayoutGrid size={16} strokeWidth={1.75} />, label: t('browse.viewGrid') },
  ]
  return (
    <div
      className="flex h-[28px] shrink-0 items-center rounded-std border border-[var(--line-1)]"
      role="radiogroup"
      aria-label={`${t('browse.viewRows')} / ${t('browse.viewGrid')}`}
    >
      {segments.map(seg => {
        const active = view === seg.mode
        return (
          <button
            key={seg.mode}
            type="button"
            role="radio"
            aria-checked={active}
            title={seg.label}
            onClick={() => onChange(seg.mode)}
            className={`relative flex h-[28px] w-[32px] cursor-pointer items-center justify-center ${
              active ? 'text-[var(--accent-text)]' : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
            }`}
          >
            {active ? (
              <motion.span
                layoutId="browse-view-pill"
                transition={snap}
                className="absolute inset-[2px] rounded-chip bg-[var(--accent-tint)]"
              />
            ) : null}
            <span className="relative">{seg.icon}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------ result views */

function BrowseRow({
  item,
  game,
  subsApi,
  onRequest,
}: {
  item: BrowseItem
  game: GameInfo
  subsApi: SubscriptionsApi
  onRequest: (item: BrowseItem) => void
}): ReactNode {
  const { t, lang, state, openDetail } = useHub()
  // The detail sheet serves locally tracked mods (GET /api/mods/:id 404s
  // otherwise) — wire row-click -> openDetail only for known items.
  const known =
    Boolean(item.subscribed) ||
    Boolean(item.installed) ||
    (state?.mods.some(m => m.id === item.id) ?? false)
  return (
    <GridRow onClick={known ? () => openDetail(item.id) : undefined}>
      {/* identity: 112x52 thumb + title (+banned) + author + tags (max 3) */}
      <GridCell className="py-[6px]">
        <span className="w-[112px] shrink-0">
          <ImageFrame
            src={item.previewUrl}
            aspect="112 / 52"
            appId={game.appId}
            gameName={game.name}
            title={item.title}
          />
        </span>
        <span className="flex min-w-0 flex-col gap-[2px]">
          <span className="flex min-w-0 items-center gap-[6px]">
            <a
              href={browserPageUrl(item.id)}
              target="_blank"
              rel="noopener noreferrer"
              title={t('action.openBrowser')}
              onClick={e => e.stopPropagation()}
              className="truncate text-[13px] leading-[17px] font-medium text-[var(--text-1)] hover:underline"
            >
              {item.title}
            </a>
            {item.banned ? <BannedTag /> : null}
          </span>
          <span className="flex min-w-0 items-center gap-[6px]">
            {item.author ? (
              <span className="flex min-w-0 shrink-0 items-center gap-[4px] text-[11px] leading-[14px] text-[var(--text-3)]">
                {item.authorAvatarUrl ? (
                  <img
                    src={img(item.authorAvatarUrl)}
                    alt=""
                    loading="lazy"
                    className="h-[14px] w-[14px] rounded-[2px] border border-[var(--line-1)]"
                  />
                ) : null}
                <span className="max-w-[140px] truncate">{item.author}</span>
              </span>
            ) : null}
            <TagChips tags={item.tags} />
          </span>
        </span>
      </GridCell>

      <GridCell>
        <StarRating score={item.score} count={item.voteCount} />
      </GridCell>

      <GridCell numeric mono className="whitespace-nowrap">
        <span title={t('meta.subscribers')}>{formatCountExact(item.subs)}</span>
      </GridCell>

      <GridCell numeric mono className="whitespace-nowrap">
        <span title={item.timeUpdated ? absDateTime(lang, item.timeUpdated) : undefined}>
          {relTime(lang, item.timeUpdated)}
        </span>
      </GridCell>

      <GridCell className="justify-end">
        <SubscribeControl item={item} subs={subsApi} onRequest={onRequest} />
      </GridCell>
    </GridRow>
  )
}

function PosterTile({
  item,
  game,
  subsApi,
  onRequest,
}: {
  item: BrowseItem
  game: GameInfo
  subsApi: SubscriptionsApi
  onRequest: (item: BrowseItem) => void
}): ReactNode {
  const { t } = useHub()
  // Chips (subscribed/installed) and in-flight pendings stay visible;
  // the raw Subscribe button reveals on hover/focus (150ms, per spec).
  const alwaysVisible =
    Boolean(item.installed) ||
    Boolean(item.subscribed) ||
    subsApi.settled.has(item.id) ||
    subsApi.pending.has(item.id)
  return (
    <div className="group relative">
      <ImageFrame
        src={item.previewUrl}
        aspect="2.14 / 1"
        appId={game.appId}
        gameName={game.name}
        title={item.title}
        scrim
      >
        <div className="flex h-full flex-col justify-between p-[10px]">
          <div className="flex items-start justify-between gap-[8px]">
            {item.banned ? <BannedTag onArt /> : <span />}
            <span
              className={
                alwaysVisible
                  ? ''
                  : 'opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100'
              }
            >
              <SubscribeControl item={item} subs={subsApi} onRequest={onRequest} onArt />
            </span>
          </div>
          {/* scrim text is always light-on-dark in both themes */}
          <div className="flex items-end justify-between gap-[8px]">
            <span className="flex min-w-0 flex-col">
              <a
                href={browserPageUrl(item.id)}
                target="_blank"
                rel="noopener noreferrer"
                title={t('action.openBrowser')}
                className="truncate text-[13px] leading-[17px] font-semibold text-[#e9eef2] hover:underline"
              >
                {item.title}
              </a>
              {item.author ? (
                <span className="truncate text-[11px] leading-[14px] text-[rgba(233,238,242,0.64)]">
                  {item.author}
                </span>
              ) : null}
            </span>
            <span
              className="voice-mono-sm shrink-0 text-[rgba(233,238,242,0.64)]"
              title={t('meta.subscribers')}
            >
              {formatCountCompact(item.subs)}
            </span>
          </div>
        </div>
      </ImageFrame>
    </div>
  )
}

/* ------------------------------------------------------------ page */

export default function BrowsePage(): ReactNode {
  const { state, t, scope, setScope, navigate } = useHub()

  /* ----- game tabs: installed games; rail scope preselects ----- */
  const games = useMemo(() => (state?.games ?? []).filter(g => g.installed), [state])
  const selectedAppId = useMemo(() => {
    if (scope !== null && games.some(g => g.appId === scope)) return scope
    return games[0]?.appId ?? null
  }, [scope, games])
  const selectedGame = games.find(g => g.appId === selectedAppId) ?? null
  const canBrowse = selectedGame !== null && browsable(selectedGame)

  /* ----- search / sort state ----- */
  const [searchInput, setSearchInput] = useState('')
  const [q, setQ] = useState('')
  const [sortTab, setSortTab] = useState<SortTab>('popular')
  const [trendWindow, setTrendWindow] = useState<TrendWindow>('7d')
  const searchRef = useRef<HTMLInputElement>(null)

  // '/' focuses search (App dispatches pmh:focus-search).
  useEffect(() => {
    const onFocusSearch = (e: Event): void => {
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('pmh:focus-search', onFocusSearch)
    return () => window.removeEventListener('pmh:focus-search', onFocusSearch)
  }, [])

  // Enter submits; relevance auto-selected with q (never sent without q).
  const submitSearch = useCallback(
    (e: FormEvent) => {
      e.preventDefault()
      const next = searchInput.trim()
      setQ(next)
      setSortTab(prev => (next ? 'relevance' : prev === 'relevance' ? 'popular' : prev))
    },
    [searchInput],
  )

  const sort: BrowseSort =
    sortTab === 'relevance' && q
      ? 'relevance'
      : sortTab === 'updated'
        ? 'updated'
        : sortTab === 'published'
          ? 'published'
          : trendWindow === '7d'
            ? 'trend7d'
            : trendWindow === '30d'
              ? 'trend30d'
              : 'popular'

  /* ----- view toggle (persisted) ----- */
  const [view, setViewState] = useState<ViewMode>(() =>
    localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'rows',
  )
  const setView = useCallback((next: ViewMode) => {
    localStorage.setItem(VIEW_KEY, next)
    setViewState(next)
  }, [])

  /* ----- one-time helper notice (localStorage) ----- */
  const [noticeDismissed, setNoticeDismissed] = useState(
    () => localStorage.getItem(NOTICE_KEY) === '1',
  )
  const dismissNotice = useCallback(() => {
    localStorage.setItem(NOTICE_KEY, '1')
    setNoticeDismissed(true)
  }, [])

  /* ----- data + subscriptions ----- */
  const data = useBrowse(selectedAppId, canBrowse, q, sort)
  const subsApi = useSubscriptions(selectedAppId)

  const [dialogItem, setDialogItem] = useState<BrowseItem | null>(null)
  const requestSubscribe = useCallback(
    (item: BrowseItem) => {
      if ((item.children?.length ?? 0) > 0) setDialogItem(item)
      else subsApi.subscribe(item.id)
    },
    [subsApi],
  )

  /* ----- shell loading ----- */
  if (!state) {
    return (
      <div className="mx-auto w-[1080px] max-w-full px-[24px] py-[20px]">
        <SkeletonRows rows={8} rowHeight={64} />
      </div>
    )
  }

  if (games.length === 0 || selectedGame === null) {
    return (
      <div className="mx-auto w-[1080px] max-w-full px-[24px] py-[20px]">
        <div className="text-[13px] text-[var(--text-3)]">{t('browse.pickGame')}</div>
      </div>
    )
  }

  const showEmpty = canBrowse && data.loaded && data.error === null && data.items.length === 0

  return (
    <div className="mx-auto w-[1080px] max-w-full px-[24px] pt-[12px] pb-[24px]">
      <GameTabs games={games} selectedAppId={selectedAppId} onSelect={appId => setScope(appId)} />

      {!canBrowse ? (
        /* explicit "no public Workshop browser" empty state (Library unaffected) */
        <div className="flex flex-col items-center gap-[10px] py-[72px]">
          <GameGlyph
            appId={selectedGame.appId}
            name={selectedGame.name}
            size={32}
            className="opacity-60"
          />
          <span className="max-w-[420px] text-center text-[13px] text-[var(--text-2)]">
            {t('browse.notBrowsable')}
          </span>
          <Button
            variant="ghost"
            className="text-[var(--accent-text)]"
            onClick={() => navigate({ page: 'library', game: selectedGame.appId })}
          >
            <ReservedText k="browse.openLibrary" center />
          </Button>
        </div>
      ) : (
        <>
          {!noticeDismissed ? (
            <div className="card mt-[12px] flex items-center gap-[10px] px-[12px] py-[7px]">
              <Info size={16} strokeWidth={1.75} className="shrink-0 text-[var(--accent-text)]" />
              <span className="voice-ui min-w-0 flex-1 text-[var(--text-2)]">
                {t('browse.helperNote')}
              </span>
              <Button variant="ghost" onClick={dismissNotice}>
                <ReservedText k="browse.noticeDismiss" center />
              </Button>
            </div>
          ) : null}

          {/* toolbar: search · sort tabs (+trend window) · results readout · view */}
          <div className="flex flex-wrap items-center gap-[10px] py-[12px]">
            <form onSubmit={submitSearch} className="shrink-0">
              <Input
                ref={searchRef}
                icon={<Search size={16} strokeWidth={1.75} />}
                kbdHint="/"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder={t('browse.search')}
                aria-label={t('browse.search')}
                className="w-[280px]"
              />
            </form>

            <SortTabs tab={sortTab} hasQuery={q !== ''} onSelect={setSortTab} />

            {sortTab === 'popular' ? (
              <select
                value={trendWindow}
                onChange={e => setTrendWindow(e.target.value as TrendWindow)}
                aria-label={t('browse.sort.popular')}
                className={SELECT_CLASS}
              >
                <option value="7d">{t('browse.sort.trend7d')}</option>
                <option value="30d">{t('browse.sort.trend30d')}</option>
                <option value="all">{t('browse.sort.alltime')}</option>
              </select>
            ) : null}

            <span
              className="voice-mono tabular ml-auto whitespace-nowrap text-[var(--text-3)]"
              title={t('browse.results', { n: data.total ?? data.items.length })}
            >
              {formatCountExact(data.items.length)} /{' '}
              {data.total !== undefined ? formatCountExact(data.total) : '—'}
            </span>

            <ViewToggle view={view} onChange={setView} />
          </div>

          {/* results */}
          {data.loading ? (
            view === 'rows' ? (
              <SkeletonRows rows={8} rowHeight={64} />
            ) : (
              <div
                className="grid gap-[12px]"
                style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
              >
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} style={{ aspectRatio: '2.14 / 1' }} />
                ))}
              </div>
            )
          ) : data.error !== null && data.items.length === 0 ? (
            <div className="card mx-auto mt-[24px] flex w-[420px] max-w-full flex-col items-center gap-[8px] px-[16px] py-[20px]">
              <span className="voice-ui-strong text-[var(--text-1)]">{t('browse.loadFailed')}</span>
              <span className="voice-mono max-w-full truncate text-[var(--text-3)]">
                {data.error}
              </span>
              <Button variant="secondary" onClick={data.retry}>
                <ReservedText k="action.retry" center />
              </Button>
            </div>
          ) : showEmpty ? (
            <div className="flex flex-col items-center gap-[8px] py-[48px]">
              <GameGlyph
                appId={selectedGame.appId}
                name={selectedGame.name}
                size={28}
                className="opacity-60"
              />
              <span className="text-[13px] text-[var(--text-2)]">{t('browse.empty')}</span>
            </div>
          ) : view === 'rows' ? (
            <GridTable columns={ROW_COLUMNS}>
              {data.items.map(item => (
                <BrowseRow
                  key={item.id}
                  item={item}
                  game={selectedGame}
                  subsApi={subsApi}
                  onRequest={requestSubscribe}
                />
              ))}
            </GridTable>
          ) : (
            <div
              className="grid gap-[12px]"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
            >
              {data.items.map(item => (
                <PosterTile
                  key={item.id}
                  item={item}
                  game={selectedGame}
                  subsApi={subsApi}
                  onRequest={requestSubscribe}
                />
              ))}
            </div>
          )}

          {/* pagination: [Load 50 more] up to capped:true */}
          {!data.loading && data.items.length > 0 ? (
            <div className="flex flex-col items-center gap-[8px] py-[16px]">
              {data.error !== null ? (
                <span className="flex items-center gap-[10px]">
                  <span className="voice-mono-sm text-[var(--state-error)]">
                    {t('browse.loadFailed')}
                  </span>
                  <Button variant="secondary" onClick={data.retry}>
                    <ReservedText k="action.retry" center />
                  </Button>
                </span>
              ) : data.hasMore ? (
                <Button variant="secondary" disabled={data.loadingMore} onClick={data.loadMore}>
                  <ReservedText k={data.loadingMore ? 'action.working' : 'browse.loadMore'} center />
                </Button>
              ) : data.capped ? (
                <span className="voice-mono-sm text-[var(--text-3)]">{t('browse.capped')}</span>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {dialogItem ? (
        <RequiredItemsDialog
          item={dialogItem}
          onCancel={() => setDialogItem(null)}
          onConfirm={() => {
            subsApi.subscribe(dialogItem.id, dialogItem.children)
            setDialogItem(null)
          }}
        />
      ) : null}
    </div>
  )
}
