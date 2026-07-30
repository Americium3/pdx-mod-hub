// LIBRARY (DESIGN_SPEC §6) — full-bleed, 24px gutters.
// Toolbar (search / state chips with live counts / game scope / sort / totals)
// over per-game collapsible groups with sticky headers on ONE continuous
// GridTable. Multi-select (ctrl/shift+click) raises the bottom COMMAND TRAY.
// Rows never animate on initial render (206 rows: plain render, no virtualization).
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowUpRight,
  Bell,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FolderOpen,
  Globe,
  Play,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import { Button } from '../../components/Button'
import { GameGlyph, TargetsPill } from '../../components/GamePill'
import {
  GridCell,
  GridHeader,
  GridHeaderCell,
  GridRow,
  GridTable,
  GroupHeader,
  RowActions,
} from '../../components/GridTable'
import { ImageFrame } from '../../components/ImageFrame'
import { InlineConfirm } from '../../components/InlineConfirm'
import { Input } from '../../components/Input'
import { KbdChip } from '../../components/KbdChip'
import { ReservedText } from '../../components/ReservedText'
import { Skeleton, SkeletonRows } from '../../components/Skeleton'
import { StateDot } from '../../components/StateDot'
import type { MsgKey } from '../../i18n'
import { MOVE, useReducedMotionSafe } from '../../motion'
import { useHub } from '../../store'
import type { GameInfo, ModState, ModSummary } from '../../types'
import { absDate, formatBytes, formatCountExact, relTime } from '../../util'

/* ------------------------------------------------------------------ types */

/**
 * The ADDED column reads timeCreated (absolute). /api/state summaries do not
 * carry it yet (it lives on ModDetail) — typed optional here so the page lights
 * up the moment the server adds it to the slim payload; renders "—" until then.
 */
type LibraryMod = ModSummary & { timeCreated?: number }

type SortKey = 'name' | 'size' | 'updated' | 'added' | 'state'

const SORT_LABEL: Record<SortKey, MsgKey> = {
  name: 'library.sort.name',
  size: 'library.sort.size',
  updated: 'library.sort.updated',
  added: 'library.sort.added',
  state: 'library.sort.state',
}

const SORT_KEYS: readonly SortKey[] = ['name', 'size', 'updated', 'added', 'state']

/** Hot -> calm ordering for the state sort. */
const STATE_RANK: Record<ModState, number> = {
  'awaiting-steam': 0,
  'queued-for-launch': 1,
  downloading: 2,
  'not-installed': 3,
  orphaned: 4,
  unverified: 5,
  error: 6,
  banned: 7,
  removed: 8,
  'up-to-date': 9,
}

type ChipKey =
  | 'cared'
  | 'awaiting'
  | 'queued'
  | 'downloading'
  | 'orphaned'
  | 'notInstalled'
  | 'removed'

interface ChipDef {
  key: ChipKey
  label: MsgKey
  /** the states this chip filters to; first entry drives the dot color */
  states: readonly ModState[]
  /** replaces `states` when the chip filters on something that is not a state */
  match?: (m: LibraryMod) => boolean
}

const CHIP_DEFS: readonly ChipDef[] = [
  { key: 'cared', label: 'library.chip.cared', states: [], match: m => m.cared },
  { key: 'awaiting', label: 'library.chip.awaiting', states: ['awaiting-steam'] },
  { key: 'queued', label: 'library.chip.queued', states: ['queued-for-launch'] },
  { key: 'downloading', label: 'library.chip.downloading', states: ['downloading'] },
  { key: 'orphaned', label: 'library.chip.orphaned', states: ['orphaned', 'unverified'] },
  { key: 'notInstalled', label: 'library.chip.notInstalled', states: ['not-installed'] },
  { key: 'removed', label: 'library.chip.removed', states: ['removed', 'banned', 'error'] },
]

function chipMatches(def: ChipDef, m: LibraryMod): boolean {
  return def.match ? def.match(m) : def.states.includes(m.state)
}

/* ------------------------------------------------------------------ layout */

// Sticky math: column header cells are 28px tall (GridHeaderCell h-[28px]),
// so group headers stick just below at top:28.
const HEADER_H = 28
const COLUMNS =
  'minmax(240px,1fr) 180px 90px 100px 90px 120px 104px 288px'

/* ------------------------------------------------------------------ helpers */

function sizeOf(m: LibraryMod): number | undefined {
  if (m.sizeOnDisk && m.sizeOnDisk > 0) return m.sizeOnDisk
  return m.sizeWorkshop
}

function hasAcf(m: LibraryMod): boolean {
  return Boolean(m.acfTs || m.sizeOnDisk)
}

function steamPageUrl(id: string): string {
  return `steam://url/CommunityFilePage/${id}`
}

function browserPageUrl(id: string): string {
  return `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`
}

function comparator(sort: SortKey): (a: LibraryMod, b: LibraryMod) => number {
  return (a, b) => {
    let d = 0
    switch (sort) {
      case 'name':
        d = a.title.localeCompare(b.title)
        break
      case 'size':
        d = (sizeOf(b) ?? 0) - (sizeOf(a) ?? 0)
        break
      case 'updated':
        d = (b.remoteTs ?? b.acfTs ?? 0) - (a.remoteTs ?? a.acfTs ?? 0)
        break
      case 'added':
        d = (b.timeCreated ?? 0) - (a.timeCreated ?? 0)
        break
      case 'state':
        d = STATE_RANK[a.state] - STATE_RANK[b.state]
        break
    }
    return d !== 0 ? d : a.title.localeCompare(b.title)
  }
}

/**
 * Ask the server to reveal the mod folder in the OS file manager.
 * The endpoint is not in the shipped API yet (noted for the integrator);
 * until it lands this returns false and the caller falls back to copying
 * the on-disk path.
 */
async function requestOpenFolder(appId: number, modId: string): Promise<boolean> {
  try {
    const res = await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'X-PMH': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId, modId }),
    })
    return res.ok
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ small parts */

function DriveOfflineChip(): ReactNode {
  return (
    <span className="inline-flex shrink-0 items-center rounded-chip border border-[var(--state-orphaned)] px-[4px] font-mono text-[10px] leading-[14px] tracking-[0.08em] text-[var(--state-orphaned)] uppercase">
      <ReservedText k="state.drive-offline" />
    </span>
  )
}

function FilterChip({
  def,
  count,
  active,
  onToggle,
}: {
  def: ChipDef
  count: number
  active: boolean
  onToggle: () => void
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`inline-flex h-[24px] cursor-pointer items-center gap-[6px] rounded-chip border px-[7px] text-[12px] whitespace-nowrap select-none ${
        active
          ? 'border-[var(--accent-graphic)] bg-[var(--accent-tint)] text-[var(--accent-text)]'
          : `border-[var(--line-2)] text-[var(--text-2)] hover:bg-[var(--bg-2)] ${count === 0 ? 'opacity-50' : ''}`
      }`}
    >
      {def.states.length > 0 ? (
        <StateDot state={def.states[0]} label={false} />
      ) : (
        <Bell size={12} strokeWidth={2} fill="currentColor" />
      )}
      <ReservedText k={def.label} />
      <span className="voice-mono-sm text-[var(--text-3)]">{count}</span>
    </button>
  )
}

const SELECT_CLASS =
  'h-[28px] cursor-pointer rounded-std border border-[var(--line-2)] bg-[var(--inset)] px-[8px] font-ui text-[12px] text-[var(--text-1)] outline-none'

/* ------------------------------------------------------------------ row */

/**
 * Per-mod opt-in to update notifications. Lives in the identity cell rather
 * than RowActions because it shows STATE, and RowActions is hover-only — the
 * watched set has to be readable at a glance down the whole list.
 */
function CareBell({ mod }: { mod: LibraryMod }): ReactNode {
  const { t, setCared } = useHub()
  const on = mod.cared
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={t(on ? 'care.off' : 'care.on', { title: mod.title })}
      title={t(on ? 'care.tipOn' : 'care.tipOff')}
      onClick={e => {
        e.stopPropagation()
        void setCared(mod.id, !on)
      }}
      className={
        'grid h-[22px] w-[22px] shrink-0 cursor-pointer place-items-center rounded-std ' +
        'transition-opacity hover:bg-[var(--bg-2)] ' +
        (on
          ? 'text-[var(--accent-text)]'
          : 'text-[var(--text-3)] opacity-35 hover:opacity-100')
      }
    >
      <Bell size={14} strokeWidth={on ? 2 : 1.75} fill={on ? 'currentColor' : 'none'} />
    </button>
  )
}

function ModRow({
  mod,
  game,
  selected,
  offline,
  steamRunning,
  onRowClick,
  onOpenFolder,
}: {
  mod: LibraryMod
  game: GameInfo | undefined
  selected: boolean
  offline: boolean
  steamRunning: boolean
  onRowClick: (mod: LibraryMod, e: ReactMouseEvent<HTMLDivElement>) => void
  onOpenFolder: (mod: LibraryMod) => void
}): ReactNode {
  const { t, lang, toast, runAction, runSync, openDetail } = useHub()

  const copyId = (): void => {
    navigator.clipboard
      .writeText(mod.id)
      .then(() => toast('success', t('toast.copied', { t: mod.id })))
      .catch(() => undefined)
  }

  return (
    <GridRow
      selected={selected}
      dimmed={offline}
      onClick={e => onRowClick(mod, e)}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter') {
          e.preventDefault()
          openDetail(mod.id)
        }
      }}
    >
      {/* identity: care bell + 64x30 thumb + title + id (mono muted) */}
      <GridCell className="py-[4px]">
        <CareBell mod={mod} />
        <span className="w-[64px] shrink-0">
          <ImageFrame
            src={mod.previewUrl}
            aspect="64 / 30"
            appId={mod.appId}
            gameName={game?.name}
            title={mod.title}
          />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-[13px] leading-[17px] font-medium text-[var(--text-1)]">
            {mod.title}
          </span>
          <span className="flex min-w-0 items-center gap-[6px]">
            <span className="voice-mono-sm truncate text-[var(--text-3)]">{mod.id}</span>
            {offline ? <DriveOfflineChip /> : null}
          </span>
        </span>
      </GridCell>

      {/* state dot + label; unverified carries the Sync-to-verify affordance */}
      <GridCell>
        <StateDot state={mod.state} />
        {mod.state === 'unverified' ? (
          <button
            type="button"
            disabled={!steamRunning}
            onClick={e => {
              e.stopPropagation()
              void runSync(mod.appId)
            }}
            className="cursor-pointer text-[11px] whitespace-nowrap text-[var(--accent-text)] hover:underline disabled:pointer-events-none disabled:opacity-40"
            title={t('library.syncHint')}
          >
            <ReservedText k="stamp.syncToVerify" />
          </button>
        ) : null}
      </GridCell>

      {/* targets pill — only when branchRange present, a fact never a verdict */}
      <GridCell>
        {mod.branchRange ? (
          <TargetsPill min={mod.branchRange.min} max={mod.branchRange.max} />
        ) : null}
      </GridCell>

      {/* size on-disk (workshop size in tooltip) */}
      <GridCell numeric mono>
        <span
          title={
            mod.sizeWorkshop
              ? `${t('meta.size')}: ${formatBytes(mod.sizeWorkshop)}`
              : undefined
          }
        >
          {formatBytes(sizeOf(mod))}
        </span>
      </GridCell>

      {/* subs — exact with commas in tables */}
      <GridCell numeric mono>
        {formatCountExact(mod.subs)}
      </GridCell>

      {/* UPDATED (remoteTs, relative) */}
      <GridCell mono>
        <span title={absDate(lang, mod.remoteTs ?? mod.acfTs)}>
          {relTime(lang, mod.remoteTs ?? mod.acfTs)}
        </span>
      </GridCell>

      {/* ADDED (timeCreated, absolute) */}
      <GridCell mono>{absDate(lang, mod.timeCreated)}</GridCell>

      {/* trailing hover actions */}
      <RowActions>
        {hasAcf(mod) ? (
          <Button
            variant="icon"
            title={t('action.openFolder')}
            onClick={() => onOpenFolder(mod)}
          >
            <FolderOpen size={16} strokeWidth={1.75} />
          </Button>
        ) : null}
        <Button
          variant="icon"
          title={t('action.openSteam')}
          onClick={() => location.assign(steamPageUrl(mod.id))}
        >
          <ArrowUpRight size={16} strokeWidth={1.75} />
        </Button>
        <Button
          variant="icon"
          title={t('action.openBrowser')}
          onClick={() => window.open(browserPageUrl(mod.id), '_blank', 'noopener')}
        >
          <Globe size={16} strokeWidth={1.75} />
        </Button>
        <Button variant="icon" title={t('action.copyId')} onClick={copyId}>
          <Copy size={16} strokeWidth={1.75} />
        </Button>
        <Button
          variant="icon"
          title={t('action.force')}
          disabled={!steamRunning}
          onClick={() => void runAction('download', { appId: mod.appId, modId: mod.id })}
        >
          <Download size={16} strokeWidth={1.75} />
        </Button>
        <InlineConfirm
          labelKey="action.unsubscribe"
          onConfirm={() => void runAction('unsubscribe', { appId: mod.appId, modId: mod.id })}
          disabled={!steamRunning}
        />
      </RowActions>
    </GridRow>
  )
}

/* ------------------------------------------------------------------ page */

export default function LibraryPage(): ReactNode {
  const {
    state,
    t,
    lang,
    scope,
    setScope,
    openDetail,
    route,
    toast,
    runAction,
    runSync,
    actions,
  } = useHub()
  const move = useReducedMotionSafe(MOVE)

  const [query, setQuery] = useState('')
  const [activeChips, setActiveChips] = useState<ReadonlySet<ChipKey>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const anchorRef = useRef<string | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const steamRunning = state?.steamRunning ?? false
  const mods = useMemo(() => (state?.mods ?? []) as LibraryMod[], [state?.mods])
  const games = useMemo(() => state?.games ?? [], [state?.games])
  const gamesById = useMemo(() => new Map(games.map(g => [g.appId, g])), [games])

  /* '/' from the app shell focuses the page search. */
  useEffect(() => {
    const onFocusSearch = (e: Event): void => {
      e.preventDefault()
      searchRef.current?.focus()
      searchRef.current?.select()
    }
    window.addEventListener('pmh:focus-search', onFocusSearch)
    return () => window.removeEventListener('pmh:focus-search', onFocusSearch)
  }, [])

  /* ----- filter pipeline: scope -> search -> (chip counts here) -> chips ----- */

  const scoped = useMemo(
    () => (scope === null ? mods : mods.filter(m => m.appId === scope)),
    [mods, scope],
  )

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return scoped
    return scoped.filter(
      m =>
        m.title.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.author ?? '').toLowerCase().includes(q),
    )
  }, [scoped, query])

  /** Live counts, computed before the chip filter itself applies. */
  const chipCounts = useMemo(() => {
    const counts: Record<ChipKey, number> = {
      cared: 0,
      awaiting: 0,
      queued: 0,
      downloading: 0,
      orphaned: 0,
      notInstalled: 0,
      removed: 0,
    }
    for (const m of searched) {
      for (const def of CHIP_DEFS) {
        if (chipMatches(def, m)) counts[def.key] += 1
      }
    }
    return counts
  }, [searched])

  const visible = useMemo(() => {
    if (activeChips.size === 0) return searched
    const active = CHIP_DEFS.filter(d => activeChips.has(d.key))
    return searched.filter(m => active.some(d => chipMatches(d, m)))
  }, [searched, activeChips])

  /* ----- grouping ----- */

  const groups = useMemo(() => {
    const byApp = new Map<number, LibraryMod[]>()
    for (const m of visible) {
      const arr = byApp.get(m.appId)
      if (arr) arr.push(m)
      else byApp.set(m.appId, [m])
    }
    const cmp = comparator(sortKey)
    const known = new Set(games.map(g => g.appId))
    const out: { game: GameInfo; mods: LibraryMod[] }[] = []
    for (const g of games) {
      const arr = byApp.get(g.appId)
      if (arr || scope === g.appId) out.push({ game: g, mods: (arr ?? []).slice().sort(cmp) })
    }
    for (const [appId, arr] of byApp) {
      if (!known.has(appId)) {
        out.push({
          game: { appId, name: `App ${appId}`, installed: false },
          mods: arr.slice().sort(cmp),
        })
      }
    }
    return out
  }, [visible, games, scope, sortKey])

  /** Visible row order across groups (skipping collapsed) — shift-range space. */
  const flatIds = useMemo(
    () => groups.flatMap(g => (collapsed[g.game.appId] ? [] : g.mods.map(m => m.id))),
    [groups, collapsed],
  )

  const totals = useMemo(() => {
    let bytes = 0
    for (const m of visible) bytes += sizeOf(m) ?? 0
    return { n: visible.length, s: formatBytes(bytes) }
  }, [visible])

  /* ----- selection ----- */

  const selectedMods = useMemo(() => {
    if (selected.size === 0) return []
    const byId = new Map(mods.map(m => [m.id, m]))
    const out: LibraryMod[] = []
    for (const id of selected) {
      const m = byId.get(id)
      if (m) out.push(m)
    }
    return out
  }, [selected, mods])

  const clearSelection = useCallback(() => {
    setSelected(new Set())
    anchorRef.current = null
  }, [])

  const onRowClick = useCallback(
    (mod: LibraryMod, e: ReactMouseEvent<HTMLDivElement>): void => {
      if (e.shiftKey) {
        const anchor = anchorRef.current ?? mod.id
        const i = flatIds.indexOf(anchor)
        const j = flatIds.indexOf(mod.id)
        if (i >= 0 && j >= 0) {
          const [lo, hi] = i < j ? [i, j] : [j, i]
          setSelected(new Set(flatIds.slice(lo, hi + 1)))
        } else {
          setSelected(new Set([mod.id]))
        }
        anchorRef.current = anchor
        return
      }
      if (e.ctrlKey || e.metaKey) {
        setSelected(prev => {
          const next = new Set(prev)
          if (next.has(mod.id)) next.delete(mod.id)
          else next.add(mod.id)
          return next
        })
        anchorRef.current = mod.id
        return
      }
      openDetail(mod.id)
    },
    [flatIds, openDetail],
  )

  /* Escape clears the selection (unless the detail sheet has it). */
  useEffect(() => {
    if (selected.size === 0) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !route.mod && !e.defaultPrevented) clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected.size, route.mod, clearSelection])

  /* ----- actions ----- */

  const openFolder = useCallback(
    (mod: LibraryMod): void => {
      void (async () => {
        const ok = await requestOpenFolder(mod.appId, mod.id)
        if (ok) return
        // Endpoint not available yet — fall back to copying the on-disk path.
        const lib = gamesById.get(mod.appId)?.libraryPath
        const path = lib
          ? `${lib}\\steamapps\\workshop\\content\\${mod.appId}\\${mod.id}`
          : mod.id
        try {
          await navigator.clipboard.writeText(path)
          toast('info', t('toast.copied', { t: path }))
        } catch {
          // clipboard unavailable — nothing else to do
        }
      })()
    },
    [gamesById, toast, t],
  )

  const bulkAction = useCallback(
    (kind: 'download' | 'unsubscribe'): void => {
      const byApp = new Map<number, string[]>()
      for (const m of selectedMods) {
        const arr = byApp.get(m.appId)
        if (arr) arr.push(m.id)
        else byApp.set(m.appId, [m.id])
      }
      for (const [appId, modIds] of byApp) void runAction(kind, { appId, modIds })
      if (kind === 'unsubscribe') clearSelection()
    },
    [selectedMods, runAction, clearSelection],
  )

  const bulkOpenFolders = useCallback((): void => {
    for (const m of selectedMods) if (hasAcf(m)) openFolder(m)
  }, [selectedMods, openFolder])

  const syncBusyFor = useCallback(
    (appId: number): boolean =>
      Object.values(actions).some(
        a =>
          (a.kind === 'sync' || a.kind === 'syncAll') &&
          a.endedAt === undefined &&
          (a.kind === 'syncAll' || a.appId === appId),
      ),
    [actions],
  )

  /* ----- render ----- */

  if (!state) {
    return (
      <div className="px-[24px] py-[16px]">
        <div className="flex items-center gap-[10px] pb-[14px]">
          <Skeleton width={240} height={32} />
          <Skeleton width={360} height={24} />
          <Skeleton width={140} height={24} className="ml-auto" />
        </div>
        <SkeletonRows rows={8} />
      </div>
    )
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="px-[24px] pt-[14px]">
        {/* -------- toolbar -------- */}
        <div className="flex flex-wrap items-center gap-x-[10px] gap-y-[8px] pb-[12px]">
          <Input
            ref={searchRef}
            value={query}
            onChange={e => setQuery(e.currentTarget.value)}
            placeholder={t('library.search')}
            icon={<Search size={16} strokeWidth={1.75} />}
            kbdHint="/"
            className="w-[240px]"
            aria-label={t('library.search')}
          />

          <div className="flex flex-wrap items-center gap-[6px]">
            {CHIP_DEFS.map(def => (
              <FilterChip
                key={def.key}
                def={def}
                count={chipCounts[def.key]}
                active={activeChips.has(def.key)}
                onToggle={() =>
                  setActiveChips(prev => {
                    const next = new Set(prev)
                    if (next.has(def.key)) next.delete(def.key)
                    else next.add(def.key)
                    return next
                  })
                }
              />
            ))}
          </div>

          <select
            value={scope === null ? '' : String(scope)}
            onChange={e => setScope(e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
            className={SELECT_CLASS}
            aria-label={t('rail.games')}
          >
            <option value="">{t('library.all')}</option>
            {games.map(g => (
              <option key={g.appId} value={g.appId}>
                {g.name}
              </option>
            ))}
          </select>

          <select
            value={sortKey}
            onChange={e => setSortKey(e.currentTarget.value as SortKey)}
            className={SELECT_CLASS}
            aria-label={t('library.sort.label')}
          >
            {SORT_KEYS.map(k => (
              <option key={k} value={k}>
                {t(SORT_LABEL[k])}
              </option>
            ))}
          </select>

          <span className="voice-mono ml-auto whitespace-nowrap text-[var(--text-2)]">
            {t('library.totals', { n: totals.n, s: totals.s })}
          </span>
        </div>
      </div>

      {/* -------- one continuous grid-table with sticky per-game groups -------- */}
      <div
        className="px-[24px] pb-[16px]"
        onMouseDown={e => {
          // shift-click means range-select, not text-select
          if (e.shiftKey) e.preventDefault()
        }}
      >
        <GridTable columns={COLUMNS}>
          <GridHeader>
            <GridHeaderCell onClick={() => setSortKey('name')}>
              <span style={sortKey === 'name' ? { color: 'var(--accent-text)' } : undefined}>
                <ReservedText k="library.col.name" />
              </span>
            </GridHeaderCell>
            <GridHeaderCell onClick={() => setSortKey('state')}>
              <span style={sortKey === 'state' ? { color: 'var(--accent-text)' } : undefined}>
                <ReservedText k="library.col.state" />
              </span>
            </GridHeaderCell>
            <GridHeaderCell>
              <ReservedText k="library.col.targets" />
            </GridHeaderCell>
            <GridHeaderCell numeric onClick={() => setSortKey('size')}>
              <span style={sortKey === 'size' ? { color: 'var(--accent-text)' } : undefined}>
                <ReservedText k="library.col.size" />
              </span>
            </GridHeaderCell>
            <GridHeaderCell numeric>
              <ReservedText k="library.col.subs" />
            </GridHeaderCell>
            <GridHeaderCell onClick={() => setSortKey('updated')}>
              <span style={sortKey === 'updated' ? { color: 'var(--accent-text)' } : undefined}>
                <ReservedText k="library.col.updated" />
              </span>
            </GridHeaderCell>
            <GridHeaderCell onClick={() => setSortKey('added')}>
              <span style={sortKey === 'added' ? { color: 'var(--accent-text)' } : undefined}>
                <ReservedText k="library.col.added" />
              </span>
            </GridHeaderCell>
            <GridHeaderCell />
          </GridHeader>

          {groups.length === 0 ? (
            <div className="px-[16px] py-[28px] text-center text-[13px] text-[var(--text-3)]">
              {t('library.empty')}
            </div>
          ) : (
            groups.map(({ game, mods: groupMods }) => {
              const isCollapsed = collapsed[game.appId] === true
              const offline = game.libraryOffline === true
              let bytes = 0
              for (const m of groupMods) bytes += sizeOf(m) ?? 0
              const syncBusy = syncBusyFor(game.appId)
              return (
                <div key={game.appId}>
                  <GroupHeader top={HEADER_H}>
                    <button
                      type="button"
                      onClick={() =>
                        setCollapsed(prev => ({ ...prev, [game.appId]: !isCollapsed }))
                      }
                      aria-expanded={!isCollapsed}
                      className="flex min-w-0 cursor-pointer items-center gap-[8px] text-left"
                    >
                      {isCollapsed ? (
                        <ChevronRight size={16} strokeWidth={1.75} className="shrink-0 text-[var(--text-3)]" />
                      ) : (
                        <ChevronDown size={16} strokeWidth={1.75} className="shrink-0 text-[var(--text-3)]" />
                      )}
                      <GameGlyph appId={game.appId} name={game.name} />
                      <span className="voice-ui-strong truncate text-[var(--text-1)]">
                        {game.name}
                      </span>
                      <span className="voice-mono whitespace-nowrap text-[var(--text-3)]">
                        {t('library.totals', { n: groupMods.length, s: formatBytes(bytes) })}
                      </span>
                    </button>
                    {offline ? <DriveOfflineChip /> : null}
                    <span className="flex-1" />
                    <Button
                      variant="ghost"
                      onClick={() => void runSync(game.appId)}
                      disabled={!steamRunning || syncBusy}
                      title={
                        game.syncedAt
                          ? t('library.synced', { t: relTime(lang, game.syncedAt) })
                          : t('library.neverSynced')
                      }
                      className="shrink-0"
                    >
                      <RefreshCw size={14} strokeWidth={1.75} />
                      <ReservedText k={syncBusy ? 'action.working' : 'action.sync'} center />
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => location.assign(`steam://run/${game.appId}`)}
                      title={t('action.launchGame')}
                      className="shrink-0"
                    >
                      <Play size={14} strokeWidth={1.75} />
                      <ReservedText k="action.launchGame" center />
                    </Button>
                  </GroupHeader>

                  {isCollapsed ? null : groupMods.length === 0 ? (
                    <div className="border-b border-[var(--line-div)] px-[16px] py-[18px] text-[13px] text-[var(--text-3)]">
                      {t('misc.emptyGame')}
                    </div>
                  ) : (
                    groupMods.map(m => (
                      <ModRow
                        key={m.id}
                        mod={m}
                        game={gamesById.get(m.appId)}
                        selected={selected.has(m.id)}
                        offline={offline}
                        steamRunning={steamRunning}
                        onRowClick={onRowClick}
                        onOpenFolder={openFolder}
                      />
                    ))
                  )}
                </div>
              )
            })
          )}
        </GridTable>
      </div>

      {/* -------- COMMAND TRAY: slides up (MOVE) while a selection lives -------- */}
      <AnimatePresence>
        {selectedMods.length > 0 ? (
          <motion.div
            initial={{ y: 56, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 56, opacity: 0 }}
            transition={move}
            className="sticky bottom-0 z-[8] mt-auto flex h-[48px] items-center gap-[10px] border-t border-[var(--line-div)] bg-[var(--bg-3)] px-[24px]"
            style={{ boxShadow: 'var(--shadow-float)' }}
          >
            <span className="voice-mono whitespace-nowrap text-[var(--text-1)]">
              <ReservedText k="library.selected" vars={{ n: selectedMods.length }} />
            </span>
            <Button
              variant="secondary"
              onClick={() => bulkAction('download')}
              disabled={!steamRunning}
              title={t('action.force')}
            >
              <Download size={16} strokeWidth={1.75} />
              <ReservedText k="action.force" center />
            </Button>
            <InlineConfirm
              labelKey="action.unsubscribe"
              onConfirm={() => bulkAction('unsubscribe')}
              disabled={!steamRunning}
            />
            <Button variant="ghost" onClick={bulkOpenFolders} title={t('library.openFolders')}>
              <FolderOpen size={16} strokeWidth={1.75} />
              <ReservedText k="library.openFolders" center />
            </Button>
            <span className="flex-1" />
            <KbdChip>Esc</KbdChip>
            <Button
              variant="icon"
              onClick={clearSelection}
              title={t('library.clearSelection')}
              aria-label={t('library.clearSelection')}
            >
              <X size={16} strokeWidth={1.75} />
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
