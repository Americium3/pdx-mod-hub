// SETTINGS — 640px column, flat hairline rows, condensed-caps section labels
// (DESIGN_SPEC §6). Sections: Polling (interval + check now + changelog
// prefetch) · Interface (language + theme) · Storage (data folder + image
// cache) · Diagnostics (steam root/LED, libraries, lastPoll, SSE seq, helper,
// per-game syncedAt table with Sync buttons + Sync all, probe-owned).
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../../api'
import { pair } from '../../i18n'
import { Button } from '../../components/Button'
import { GamePill, GameGlyph } from '../../components/GamePill'
import {
  GridCell,
  GridHeader,
  GridHeaderCell,
  GridRow,
  GridTable,
} from '../../components/GridTable'
import { InlineConfirm } from '../../components/InlineConfirm'
import { Input } from '../../components/Input'
import { ReservedText } from '../../components/ReservedText'
import { ThemeControl } from '../../components/ThemeControl'
import { SNAP, useReducedMotionSafe } from '../../motion'
import { useHub } from '../../store'
import type { ActionProgress, GameInfo, Settings } from '../../types'
import { absDateTime, formatBytes, gameShort, relTime, reservedEm } from '../../util'
import {
  fetchImgCache,
  openFolder,
  patchSettingsDetailed,
  probeOwned,
  SettingsValidationError,
  type ImgCacheInfo,
  type ProbeOwnedEntry,
} from './lib'
import { Toggle } from './Toggle'

/* The stage-B state payload carries diagnostics fields the slim shared type
   does not declare yet; read them defensively off the same object. */
interface DiagExtras {
  steamRoot?: string | null
  libraries?: { path: string; reachable: boolean }[]
}

/* ---------- Layout primitives (flat hairline rows) ---------- */

function Section({ label, children }: { label: ReactNode; children: ReactNode }): ReactNode {
  return (
    <section className="mb-[26px]">
      <div className="voice-label pb-[8px]">{label}</div>
      <div className="border-b border-[var(--line-div)]">{children}</div>
    </section>
  )
}

function Row({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string
  children?: ReactNode
}): ReactNode {
  return (
    <div className="hairline-t flex min-h-[44px] items-center justify-between gap-[16px] py-[10px]">
      <div className="min-w-0">
        <div className="text-[13px] text-[var(--text-1)]">{label}</div>
        {hint ? <div className="pt-[2px] text-[12px] text-[var(--text-3)]">{hint}</div> : null}
        {error ? (
          <div className="voice-mono-sm pt-[3px] text-[var(--state-error)]">{error}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-[10px]">{children}</div>
    </div>
  )
}

/** Green "Saved" flash, scoped per row to the field(s) actually saved. */
function SavedFlash({ show }: { show: boolean }): ReactNode {
  return (
    <AnimatePresence>
      {show ? (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="voice-mono-sm text-[var(--state-fetched)]"
        >
          <ReservedText k="settings.saved" />
        </motion.span>
      ) : null}
    </AnimatePresence>
  )
}

/**
 * Button label that swaps to "Working…" while busy, with width reserved
 * across BOTH labels in BOTH locales (zero layout shift, DESIGN_SPEC §3).
 */
function BusyLabel({
  busy,
  idle,
  active,
}: {
  busy: boolean
  idle: { en: string; zh: string }
  active: string
}): ReactNode {
  const working = pair('action.working')
  return (
    <span className="reserve reserve-center">
      {[idle.en, idle.zh, working.en, working.zh].map((s, i) => (
        <span key={i} className="reserve-ghost" aria-hidden="true">
          {s}
        </span>
      ))}
      <span>{active}</span>
    </span>
  )
}

/** 6px status dot: solid on-color when on, hollow error ring when off. */
function Led({ on, color = 'var(--state-fetched)' }: { on: boolean; color?: string }): ReactNode {
  return (
    <span
      className="inline-block h-[6px] w-[6px] shrink-0 rounded-full"
      style={
        on
          ? { background: color }
          : { background: 'transparent', boxShadow: 'inset 0 0 0 1px var(--state-error)' }
      }
    />
  )
}

/* ---------- Language segmented (mirrors the rail toggle, same store setter) ---------- */

function LangControl(): ReactNode {
  const { lang, setLang, t } = useHub()
  const snap = useReducedMotionSafe(SNAP)
  const segments = [
    { code: 'en' as const, label: 'EN' },
    { code: 'zh' as const, label: '中文' },
  ]
  return (
    <div
      className="flex h-[28px] items-center rounded-std border border-[var(--line-1)]"
      role="radiogroup"
      aria-label={t('settings.language')}
    >
      {segments.map(seg => {
        const active = lang === seg.code
        return (
          <button
            key={seg.code}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setLang(seg.code)}
            className={`relative flex h-[28px] cursor-pointer items-center px-[12px] font-mono text-[11px] ${
              active
                ? 'text-[var(--accent-text)]'
                : 'text-[var(--text-3)] hover:text-[var(--text-2)]'
            }`}
          >
            {active ? (
              <motion.span
                layoutId="lang-pill-settings"
                transition={snap}
                className="absolute inset-[2px] rounded-chip bg-[var(--accent-tint)]"
              />
            ) : null}
            <span className="relative">{seg.label}</span>
          </button>
        )
      })}
    </div>
  )
}

/* ---------- Page ---------- */

const POLL_MIN = 60
const POLL_MAX = 3600

export default function SettingsPage(): ReactNode {
  const { state, t, lang, refresh, toast, seq, sseConnected, helperActive, actions, runSync, themeMode } =
    useHub()

  const settings: Settings | undefined = state?.settings
  const diag = state as (typeof state & DiagExtras) | null
  const steamRunning = state?.steamRunning ?? false

  /* ----- PATCH plumbing: per-field 422 display + saved flash ----- */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [savedFlash, setSavedFlash] = useState(0)
  const [savedFields, setSavedFields] = useState<string[]>([])
  const [showSaved, setShowSaved] = useState(false)

  useEffect(() => {
    if (savedFlash === 0) return undefined
    setShowSaved(true)
    const timer = setTimeout(() => setShowSaved(false), 2000)
    return () => clearTimeout(timer)
  }, [savedFlash])

  const save = useCallback(
    async (patch: Partial<Settings>): Promise<boolean> => {
      try {
        await patchSettingsDetailed(patch)
        setFieldErrors(prev => {
          const next = { ...prev }
          for (const key of Object.keys(patch)) delete next[key]
          return next
        })
        await refresh()
        setSavedFields(Object.keys(patch))
        setSavedFlash(x => x + 1)
        return true
      } catch (e) {
        if (e instanceof SettingsValidationError) {
          setFieldErrors(prev => ({ ...prev, ...e.fields }))
        } else {
          toast('error', t('toast.actionFailed', { e: e instanceof Error ? e.message : String(e) }))
        }
        return false
      }
    },
    [refresh, t, toast],
  )

  /* ----- Poll interval (clamped 60–3600, PATCH on blur) ----- */
  const serverInterval = settings?.pollIntervalSec
  const [intervalDraft, setIntervalDraft] = useState('')
  const [intervalDirty, setIntervalDirty] = useState(false)

  useEffect(() => {
    if (!intervalDirty && serverInterval !== undefined) setIntervalDraft(String(serverInterval))
  }, [serverInterval, intervalDirty])

  const commitInterval = useCallback((): void => {
    setIntervalDirty(false)
    if (serverInterval === undefined) return
    const n = Number(intervalDraft)
    if (!Number.isFinite(n) || intervalDraft.trim() === '') {
      setIntervalDraft(String(serverInterval))
      return
    }
    const clamped = Math.min(POLL_MAX, Math.max(POLL_MIN, Math.round(n)))
    setIntervalDraft(String(clamped))
    if (clamped !== serverInterval) void save({ pollIntervalSec: clamped })
  }, [intervalDraft, serverInterval, save])

  /* ----- Check now ----- */
  const [checking, setChecking] = useState(false)
  const onCheckNow = useCallback(async (): Promise<void> => {
    setChecking(true)
    try {
      await api.checkNow()
      await refresh()
    } catch (e) {
      toast('error', t('toast.actionFailed', { e: e instanceof Error ? e.message : String(e) }))
    } finally {
      setChecking(false)
    }
  }, [refresh, t, toast])

  /* ----- Changelog prefetch toggle (optimistic, reverts via refetch) ----- */
  const serverPrefetch = settings?.changelogPrefetch ?? false
  const [prefetchPending, setPrefetchPending] = useState<boolean | null>(null)
  const prefetchOn = prefetchPending ?? serverPrefetch
  const onPrefetch = useCallback(
    async (next: boolean): Promise<void> => {
      setPrefetchPending(next)
      await save({ changelogPrefetch: next })
      setPrefetchPending(null)
    },
    [save],
  )

  /* ----- Data folder ----- */
  const dataFolder = settings?.dataFolder
  const onOpenFolder = useCallback(async (): Promise<void> => {
    try {
      await openFolder(dataFolder)
    } catch (e) {
      toast('error', t('toast.actionFailed', { e: e instanceof Error ? e.message : String(e) }))
    }
  }, [dataFolder, t, toast])

  /* ----- Image cache ----- */
  const [cache, setCache] = useState<ImgCacheInfo | null>(null)
  const loadCache = useCallback(async (): Promise<void> => {
    try {
      setCache(await fetchImgCache())
    } catch {
      setCache({ bytes: null, files: null })
    }
  }, [])
  useEffect(() => {
    void loadCache()
  }, [loadCache])

  const onClearCache = useCallback(async (): Promise<void> => {
    try {
      await api.clearImageCache()
      toast('success', t('settings.cacheCleared'))
    } catch (e) {
      toast('error', t('toast.actionFailed', { e: e instanceof Error ? e.message : String(e) }))
    } finally {
      void loadCache()
    }
  }, [loadCache, t, toast])

  /* ----- Sync actions (per-game + all, sequential progress over SSE) ----- */
  const syncActs = useMemo(
    () =>
      Object.values(actions).filter(
        (a: ActionProgress) => (a.kind === 'sync' || a.kind === 'syncAll') && a.endedAt === undefined,
      ),
    [actions],
  )
  const syncBusy = syncActs.length > 0
  const syncAllAct = syncActs.find(a => a.kind === 'syncAll')
  const currentSyncGame =
    syncAllAct?.appId !== undefined
      ? state?.games.find(g => g.appId === syncAllAct.appId)
      : undefined

  const installedGames = useMemo(
    () =>
      (state?.games ?? [])
        .filter(g => g.installed)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [state],
  )

  const warnings = useMemo(
    () =>
      (state?.games ?? []).flatMap(g =>
        (g.warnings ?? []).map(w => ({ short: gameShort(g.appId, g.name), text: w })),
      ),
    [state],
  )

  /* ----- Probe owned ----- */
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<Record<string, ProbeOwnedEntry> | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)

  const onProbe = useCallback(async (): Promise<void> => {
    setProbing(true)
    setProbeError(null)
    try {
      setProbeResult(await probeOwned())
    } catch (e) {
      setProbeError(e instanceof Error ? e.message : String(e))
    } finally {
      setProbing(false)
    }
  }, [])

  const ownedNotInstalled = useMemo(() => {
    if (!probeResult) return null
    return Object.entries(probeResult)
      .filter(([, v]) => v.owned && !v.installed)
      .map(([id]) => {
        const appId = Number(id)
        return { appId, game: state?.games.find(g => g.appId === appId) }
      })
      .sort((a, b) => (a.game?.name ?? String(a.appId)).localeCompare(b.game?.name ?? String(b.appId)))
  }, [probeResult, state])

  const probeBtn = pair('settings.probeRun')
  const lastPoll = state?.lastPoll

  return (
    <div className="mx-auto w-[640px] max-w-full px-[24px] py-[20px]">
      <div className="pb-[18px] text-[13px] text-[var(--text-2)]">{t('settings.subtitle')}</div>

      {/* ============ POLLING ============ */}
      <Section label={<ReservedText k="settings.polling" />}>
        <Row
          label={<ReservedText k="settings.pollInterval" />}
          hint={t('settings.pollIntervalHint')}
          error={fieldErrors.pollIntervalSec}
        >
          <SavedFlash show={showSaved && savedFields.includes('pollIntervalSec')} />
          <Input
            type="number"
            min={POLL_MIN}
            max={POLL_MAX}
            step={10}
            inputMode="numeric"
            className="w-[104px]"
            value={intervalDraft}
            aria-label={t('settings.pollInterval')}
            onChange={e => {
              setIntervalDraft(e.target.value)
              setIntervalDirty(true)
            }}
            onBlur={commitInterval}
            onKeyDown={e => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
          <Button variant="secondary" disabled={checking} onClick={() => void onCheckNow()}>
            <BusyLabel
              busy={checking}
              idle={pair('action.checkNow')}
              active={checking ? t('action.working') : t('action.checkNow')}
            />
          </Button>
        </Row>

        <Row
          label={<ReservedText k="settings.prefetch" />}
          hint={t('settings.prefetchHint')}
          error={fieldErrors.changelogPrefetch}
        >
          <SavedFlash show={showSaved && savedFields.includes('changelogPrefetch')} />
          <Toggle
            checked={prefetchOn}
            disabled={!settings || prefetchPending !== null}
            onChange={next => void onPrefetch(next)}
            aria-label={t('settings.prefetch')}
          />
        </Row>
      </Section>

      {/* ============ INTERFACE ============ */}
      <Section label={t('settings.interface')}>
        <Row label={<ReservedText k="settings.language" />} error={fieldErrors.language}>
          <LangControl />
        </Row>
        <Row label={<ReservedText k="settings.theme" />}>
          <span className="text-[12px] text-[var(--text-3)]">{t(`theme.${themeMode}`)}</span>
          <ThemeControl layoutIdSuffix="settings" />
        </Row>
      </Section>

      {/* ============ STORAGE ============ */}
      <Section label={t('settings.storage')}>
        <Row label={<ReservedText k="settings.dataFolder" />} hint={t('settings.dataFolderHint')}>
          <span
            className="voice-mono max-w-[240px] truncate text-[var(--text-2)]"
            title={dataFolder ?? undefined}
          >
            {dataFolder ?? '—'}
          </span>
          <Button variant="secondary" disabled={!dataFolder} onClick={() => void onOpenFolder()}>
            <ReservedText k="settings.dataFolderOpen" center />
          </Button>
        </Row>

        <Row label={<ReservedText k="settings.imageCache" />} hint={t('settings.imageCacheHint')}>
          <span className="voice-mono text-[var(--text-2)]">
            {cache && cache.bytes !== null ? formatBytes(cache.bytes) : '—'}
          </span>
          <InlineConfirm
            labelKey="settings.imageCacheClear"
            confirmKey="confirm.generic"
            variant="destructive"
            onConfirm={() => void onClearCache()}
          />
        </Row>
      </Section>

      {/* ============ DIAGNOSTICS ============ */}
      <Section label={<ReservedText k="settings.diagnostics" />}>
        <Row label={<ReservedText k="settings.steamRunning" />}>
          <Led on={steamRunning} />
          <span
            className={`text-[12px] ${steamRunning ? 'text-[var(--text-2)]' : 'text-[var(--state-error)]'}`}
          >
            {steamRunning ? t('settings.running') : t('settings.notRunning')}
          </span>
        </Row>

        <Row label={t('settings.steamRoot')}>
          <span
            className="voice-mono max-w-[300px] truncate text-[var(--text-2)]"
            title={diag?.steamRoot ?? undefined}
          >
            {diag?.steamRoot ?? '—'}
          </span>
        </Row>

        <div className="hairline-t py-[10px]">
          <div className="pb-[6px] text-[13px] text-[var(--text-1)]">
            <ReservedText k="settings.libraries" />
          </div>
          {(diag?.libraries ?? []).length === 0 ? (
            <div className="voice-mono text-[var(--text-3)]">—</div>
          ) : (
            (diag?.libraries ?? []).map(lib => (
              <div key={lib.path} className="flex items-center gap-[8px] py-[2px]">
                <span className="voice-mono min-w-0 truncate text-[var(--text-2)]" title={lib.path}>
                  {lib.path}
                </span>
                {!lib.reachable ? (
                  <span className="voice-mono-sm shrink-0 rounded-chip border border-[var(--state-orphaned)] px-[5px] py-[1px] text-[var(--state-orphaned)]">
                    {t('state.drive-offline')}
                  </span>
                ) : null}
              </div>
            ))
          )}
          {warnings.length > 0 ? (
            <div className="pt-[6px]">
              <div className="voice-label pb-[2px]">{t('settings.warnings')}</div>
              {warnings.map((w, i) => (
                <div key={i} className="voice-mono-sm py-[1px] text-[var(--state-error)]">
                  {w.short}: {w.text}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <Row label={<ReservedText k="settings.lastPoll" />}>
          {lastPoll && lastPoll.status !== 'never' ? (
            lastPoll.status === 'ok' ? (
              <span
                className="voice-mono inline-flex items-center gap-[7px] text-[var(--text-2)]"
                title={absDateTime(lang, lastPoll.at)}
              >
                <Led on />
                {relTime(lang, lastPoll.at)}
              </span>
            ) : (
              <span
                className="voice-mono inline-flex items-center gap-[7px] text-[var(--state-error)]"
                title={lastPoll.error}
              >
                <Led on={false} />
                {t('ops.pollFailed')}
              </span>
            )
          ) : (
            <span className="voice-mono text-[var(--text-3)]">{t('misc.never')}</span>
          )}
        </Row>

        <Row label={<ReservedText k="settings.seq" />}>
          <span className="voice-mono inline-flex items-center gap-[7px] text-[var(--text-2)]">
            <Led on={sseConnected} />
            {seq}
          </span>
        </Row>

        <Row label={<ReservedText k="settings.helperState" />}>
          <span className="voice-mono inline-flex items-center gap-[7px] text-[var(--text-2)]">
            <span
              className="inline-block h-[6px] w-[6px] shrink-0 rounded-full"
              style={
                helperActive
                  ? { background: 'var(--state-downloading)' }
                  : { background: 'var(--state-uptodate)' }
              }
            />
            {helperActive ? t('settings.helperActive') : t('settings.helperIdle')}
          </span>
        </Row>

        {/* Per-game syncedAt table + Sync all */}
        <div className="hairline-t flex min-h-[44px] items-center justify-between gap-[16px] py-[8px]">
          <div className="min-w-0 text-[12px] text-[var(--text-3)]">{t('settings.syncAllHint')}</div>
          <div className="flex shrink-0 items-center gap-[10px]">
            {syncAllAct ? (
              <span className="voice-mono-sm text-[var(--accent-text)]">
                {t(`stage.${syncAllAct.stage}`)}
                {currentSyncGame ? ` · ${currentSyncGame.name}` : ''}
              </span>
            ) : null}
            <Button
              variant="secondary"
              disabled={!steamRunning || syncBusy}
              onClick={() => void runSync()}
            >
              <ReservedText k="action.syncAll" center />
            </Button>
          </div>
        </div>

        <GridTable columns="minmax(170px,1fr) 150px 130px" className="hairline-t">
          <GridHeader>
            <GridHeaderCell className="!px-[0px]">{t('settings.colGame')}</GridHeaderCell>
            <GridHeaderCell numeric>{t('settings.colSynced')}</GridHeaderCell>
            <GridHeaderCell numeric>{}</GridHeaderCell>
          </GridHeader>
          {installedGames.map((g: GameInfo) => {
            const act = syncActs.find(a => a.appId === g.appId)
            return (
              <GridRow key={g.appId} dimmed={g.libraryOffline === true}>
                <GridCell className="!px-[0px]">
                  <GameGlyph appId={g.appId} name={g.name} />
                  <span className="min-w-0 truncate">{g.name}</span>
                  {g.libraryOffline ? (
                    <span className="voice-mono-sm shrink-0 rounded-chip border border-[var(--state-orphaned)] px-[5px] py-[1px] text-[var(--state-orphaned)]">
                      {t('state.drive-offline')}
                    </span>
                  ) : null}
                </GridCell>
                <GridCell numeric mono>
                  <span title={g.syncedAt ? absDateTime(lang, g.syncedAt) : undefined}>
                    {g.syncedAt ? relTime(lang, g.syncedAt) : t('misc.never')}
                  </span>
                </GridCell>
                <GridCell numeric className="!px-[0px] justify-end">
                  {act ? (
                    <span className="voice-mono-sm text-[var(--accent-text)]">
                      {t(`stage.${act.stage}`)}
                      {act.stage === 'queued' && act.queuePosition !== undefined
                        ? ` · #${act.queuePosition}`
                        : ''}
                    </span>
                  ) : (
                    <Button
                      variant="ghost"
                      disabled={!steamRunning || syncAllAct !== undefined}
                      onClick={() => void runSync(g.appId)}
                      title={t('library.syncHint')}
                    >
                      <ReservedText k="action.sync" center />
                    </Button>
                  )}
                </GridCell>
              </GridRow>
            )
          })}
        </GridTable>

        {/* Probe owned-not-installed */}
        <Row label={t('settings.probeOwned')} hint={t('settings.probeOwnedHint')} error={probeError ?? undefined}>
          <Button
            variant="secondary"
            disabled={probing || !steamRunning}
            onClick={() => void onProbe()}
            className="justify-center"
          >
            <BusyLabel
              busy={probing}
              idle={probeBtn}
              active={probing ? t('action.working') : t('settings.probeRun')}
            />
          </Button>
        </Row>

        {ownedNotInstalled !== null ? (
          <div className="hairline-t py-[10px]">
            <div className="voice-label pb-[6px]">{t('settings.ownedNotInstalled')}</div>
            {ownedNotInstalled.length === 0 ? (
              <div className="text-[12px] text-[var(--text-3)]">{t('settings.probeNone')}</div>
            ) : (
              ownedNotInstalled.map(item => (
                <div key={item.appId} className="flex h-[30px] items-center gap-[8px]">
                  <GamePill appId={item.appId} name={item.game?.name} />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--text-2)]">
                    {item.game?.name ?? `App ${item.appId}`}
                  </span>
                  <span className="voice-mono-sm text-[var(--text-3)]">{item.appId}</span>
                </div>
              ))
            )}
          </div>
        ) : null}
      </Section>
    </div>
  )
}
