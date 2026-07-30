import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api, ApiError, connectEvents } from './api'
import type { Lang, MsgKey } from './i18n'
import { translate } from './i18n'
import { applyTheme, loadThemeMode, saveThemeMode, watchSystemTheme, type ThemeMode } from './theme'
import type { ActionKind, ActionProgress, ActionStage, HubState, SsePoke } from './types'
import { TERMINAL_STAGES } from './types'

/* ---------- Tiny hash router (no router dep) ----------
   #/page?game=<appId>&mod=<id>  — game doubles as the per-game scope. */

export type PageName = 'updates' | 'library' | 'browse' | 'settings'

export interface Route {
  page: PageName
  game: number | null
  mod: string | null
}

const PAGES: readonly PageName[] = ['updates', 'library', 'browse', 'settings']

function parseHash(hash: string): Route {
  const m = /^#\/?([a-z]*)\??(.*)$/.exec(hash)
  const raw = (m?.[1] ?? '') as PageName
  const page = PAGES.includes(raw) ? raw : 'updates'
  const q = new URLSearchParams(m?.[2] ?? '')
  const gameRaw = Number(q.get('game'))
  return {
    page,
    game: Number.isFinite(gameRaw) && gameRaw > 0 ? gameRaw : null,
    mod: q.get('mod'),
  }
}

function formatHash(route: Route): string {
  const q = new URLSearchParams()
  if (route.game !== null) q.set('game', String(route.game))
  if (route.mod !== null) q.set('mod', route.mod)
  const qs = q.toString()
  return `#/${route.page}${qs ? `?${qs}` : ''}`
}

/* ---------- Toasts ---------- */

export type ToastKind = 'info' | 'success' | 'error' | 'pending'

export interface ToastItem {
  id: number
  kind: ToastKind
  text: string
  /** auto-dismiss in ms */
  ttl: number
}

/* ---------- Context ---------- */

interface HubContextValue {
  state: HubState | null
  error: string | null
  refresh: () => Promise<void>

  // i18n
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: MsgKey, vars?: Record<string, string | number>) => string

  // theme
  themeMode: ThemeMode
  setThemeMode: (mode: ThemeMode) => void

  // routing / scope
  route: Route
  navigate: (patch: Partial<Route>) => void
  openDetail: (modId: string) => void
  closeDetail: () => void
  scope: number | null
  setScope: (appId: number | null) => void

  // liveness
  sseConnected: boolean
  helperActive: boolean
  /** last seen monotonic seq from state/SSE (persisted for after_seq catch-up) */
  seq: number
  /** increments on every feed poke AND every SSE (re)open — pages refetch on change */
  feedPulse: number

  // actions in flight
  actions: Record<string, ActionProgress>
  /**
   * Submit action job(s). The server accepts ONE modId per job, so a
   * `modIds` payload fans out into sequential posts (one 202 job each);
   * returns the first accepted actionId, or null if the first post was
   * refused (409 steam_not_running / transport error — already toasted).
   */
  runAction: (
    kind: Extract<ActionKind, 'subscribe' | 'unsubscribe' | 'download' | 'force'>,
    payload: { appId: number; modId?: string; modIds?: string[] },
  ) => Promise<string | null>
  runSync: (appId?: number) => Promise<string | null>
  /** Opt a mod in/out of update notifications (optimistic; rolls back on failure). */
  setCared: (modId: string, cared: boolean) => Promise<void>

  // toasts
  toasts: ToastItem[]
  toast: (kind: ToastKind, text: string, ttl?: number) => void
  dismissToast: (id: number) => void

  // selectors
  pendingCount: number
}

const HubContext = createContext<HubContextValue | null>(null)

const SEQ_KEY = 'pmh.seq'

function loadSeq(): number {
  const n = Number(localStorage.getItem(SEQ_KEY))
  return Number.isFinite(n) && n > 0 ? n : 0
}

let toastCounter = 0

export function HubProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<HubState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sseConnected, setSseConnected] = useState(false)
  const [seq, setSeq] = useState<number>(loadSeq)
  const [feedPulse, setFeedPulse] = useState(0)
  const [actions, setActions] = useState<Record<string, ActionProgress>>({})
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [route, setRoute] = useState<Route>(() => parseHash(location.hash))
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('pmh.lang')
    return saved === 'zh' ? 'zh' : 'en'
  })
  const [themeMode, setThemeModeState] = useState<ThemeMode>(loadThemeMode)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /* ----- theme ----- */
  useEffect(() => {
    applyTheme(themeMode)
    return watchSystemTheme(() => themeMode)
  }, [themeMode])

  const setThemeMode = useCallback((mode: ThemeMode) => {
    saveThemeMode(mode)
    setThemeModeState(mode)
  }, [])

  /* ----- lang: reflect on <html lang> so CJK label-voice rules apply ----- */
  useEffect(() => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem('pmh.lang', next)
    setLangState(next)
  }, [])

  const t = useCallback(
    (key: MsgKey, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  )

  /* ----- routing ----- */
  useEffect(() => {
    const onHash = (): void => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', onHash)
    if (!location.hash) history.replaceState(null, '', formatHash(parseHash('')))
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = useCallback((patch: Partial<Route>) => {
    setRoute(prev => {
      const next: Route = { ...prev, ...patch }
      const hash = formatHash(next)
      if (hash !== location.hash) location.hash = hash
      return next
    })
  }, [])

  const openDetail = useCallback((modId: string) => navigate({ mod: modId }), [navigate])
  const closeDetail = useCallback(() => navigate({ mod: null }), [navigate])
  const setScope = useCallback((appId: number | null) => navigate({ game: appId }), [navigate])

  /* ----- toasts ----- */
  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(x => x.id !== id))
  }, [])

  const toast = useCallback((kind: ToastKind, text: string, ttl = 5000) => {
    const id = ++toastCounter
    setToasts(prev => [...prev.slice(-3), { id, kind, text, ttl }])
  }, [])

  /* ----- state fetch ----- */
  const refresh = useCallback(async () => {
    try {
      const next = await api.state()
      setState(next)
      if (typeof next.seq === 'number') {
        setSeq(prev => {
          const merged = Math.max(prev, next.seq)
          localStorage.setItem(SEQ_KEY, String(merged))
          return merged
        })
      }
      setError(null)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }, [])

  // Debounce bursts of SSE state pokes into one fetch.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => void refresh(), 350)
  }, [refresh])

  /* ----- SSE poke channel ----- */
  const bumpSeq = useCallback((n: number) => {
    if (!Number.isFinite(n)) return
    setSeq(prev => {
      const merged = Math.max(prev, n)
      localStorage.setItem(SEQ_KEY, String(merged))
      return merged
    })
  }, [])

  const langRef = useRef(lang)
  langRef.current = lang

  const onPoke = useCallback(
    (poke: SsePoke) => {
      bumpSeq(poke.seq)
      if (poke.type === 'state') {
        scheduleRefresh()
      } else if (poke.type === 'feed') {
        setFeedPulse(p => p + 1)
        scheduleRefresh()
      } else if (poke.type === 'action') {
        const stage: ActionStage = poke.stage
        setActions(prev => {
          const existing = prev[poke.actionId]
          const next: ActionProgress = {
            actionId: poke.actionId,
            kind: poke.kind ?? existing?.kind ?? 'download',
            stage,
            appId: poke.appId ?? existing?.appId,
            modId: poke.modId ?? existing?.modId,
            modIds: existing?.modIds,
            detail: poke.detail ?? existing?.detail,
            queuePosition: poke.queuePosition,
            startedAt: existing?.startedAt ?? Date.now(),
            endedAt: TERMINAL_STAGES.includes(stage) ? Date.now() : undefined,
          }
          return { ...prev, [poke.actionId]: next }
        })
        if (stage === 'failed') {
          toast('error', translate(langRef.current, 'toast.actionFailed', { e: poke.detail ?? '' }))
        } else if (stage === 'result_ok_unconfirmed') {
          toast('info', translate(langRef.current, 'toast.unconfirmed'), 8000)
        }
        if (TERMINAL_STAGES.includes(stage)) {
          // Keep terminal actions visible briefly, then drop them.
          setTimeout(() => {
            setActions(prev => {
              if (!prev[poke.actionId]) return prev
              const { [poke.actionId]: _gone, ...rest } = prev
              return rest
            })
          }, 6000)
          scheduleRefresh()
        }
      }
    },
    [bumpSeq, scheduleRefresh, toast],
  )

  // Reconnect catch-up for in-flight actions (must-fix 4): the terminal SSE poke
  // for an action can be dropped during an SSE gap, leaving the action stuck busy
  // forever (there is no per-client poke replay). On every (re)open, query the
  // authoritative job record for each non-terminal action and merge it; a 404
  // means the record was evicted, so drop the local entry.
  const reconcileActions = useCallback(() => {
    setActions(prev => {
      for (const entry of Object.values(prev)) {
        if (entry.endedAt !== undefined) continue
        api.actionStatus(entry.actionId).then(
          job => {
            setActions(cur => {
              const existing = cur[entry.actionId]
              if (!existing) return cur
              const terminal = TERMINAL_STAGES.includes(job.stage)
              const merged: ActionProgress = {
                ...existing,
                stage: job.stage,
                kind: job.kind ?? existing.kind,
                appId: job.appId ?? existing.appId,
                modId: job.modId ?? existing.modId,
                detail: job.detail ?? existing.detail,
                queuePosition: job.queuePosition,
                endedAt: terminal ? (existing.endedAt ?? Date.now()) : existing.endedAt,
              }
              const next = { ...cur, [entry.actionId]: merged }
              if (terminal) {
                setTimeout(() => {
                  setActions(p => {
                    if (!p[entry.actionId]) return p
                    const { [entry.actionId]: _gone, ...rest } = p
                    return rest
                  })
                }, 6000)
              }
              return next
            })
          },
          e => {
            if (e instanceof ApiError && e.status === 404) {
              setActions(cur => {
                if (!cur[entry.actionId]) return cur
                const { [entry.actionId]: _gone, ...rest } = cur
                return rest
              })
            }
          },
        )
      }
      return prev
    })
  }, [])

  useEffect(() => {
    void refresh()
    const close = connectEvents({
      onPoke,
      onOpen: () => {
        setSseConnected(true)
        // Reconnect contract: refetch state; pages catch feed up via after_seq.
        void refresh()
        setFeedPulse(p => p + 1)
        // Catch up in-flight actions whose terminal poke may have been dropped
        // during the SSE gap: query the authoritative job record and merge it in
        // (drop the entry on 404 — the job record was already evicted).
        reconcileActions()
      },
      onDown: () => setSseConnected(false),
    })
    return close
  }, [refresh, onPoke, reconcileActions])

  /* ----- keep server-side language default in sync ----- */
  useEffect(() => {
    if (state && state.settings && state.settings.language !== lang) {
      void api.patchSettings({ language: lang }).catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  /* ----- actions ----- */
  const runAction = useCallback(
    async (
      kind: Extract<ActionKind, 'subscribe' | 'unsubscribe' | 'download' | 'force'>,
      payload: { appId: number; modId?: string; modIds?: string[] },
    ): Promise<string | null> => {
      const modIds =
        payload.modIds && payload.modIds.length > 0
          ? payload.modIds
          : payload.modId !== undefined
            ? [payload.modId]
            : []
      let first: string | null = null
      for (const modId of modIds) {
        try {
          // One job per mod — the server queue serializes them (must-fix 3).
          const { actionId } = await api.action(kind, { appId: payload.appId, modId })
          setActions(prev => ({
            ...prev,
            [actionId]: {
              actionId,
              kind,
              stage: 'queued',
              appId: payload.appId,
              modId,
              startedAt: Date.now(),
            },
          }))
          if (first === null) first = actionId
        } catch (e) {
          if (e instanceof ApiError && e.code === 'steam_not_running') {
            toast('error', translate(langRef.current, 'toast.steamNotRunning'))
          } else {
            toast(
              'error',
              translate(langRef.current, 'toast.actionFailed', {
                e: e instanceof Error ? e.message : String(e),
              }),
            )
          }
          // Refusal applies to the whole batch — stop fanning out.
          return first
        }
      }
      return first
    },
    [toast],
  )

  const runSync = useCallback(
    async (appId?: number): Promise<string | null> => {
      try {
        const { actionId } = await (appId === undefined ? api.syncAll() : api.sync(appId))
        if (actionId) {
          setActions(prev => ({
            ...prev,
            [actionId]: {
              actionId,
              kind: appId === undefined ? 'syncAll' : 'sync',
              stage: 'queued',
              appId,
              startedAt: Date.now(),
            },
          }))
        }
        return actionId ?? null
      } catch (e) {
        if (e instanceof ApiError && e.code === 'steam_not_running') {
          toast('error', translate(langRef.current, 'toast.steamNotRunning'))
        } else {
          toast(
            'error',
            translate(langRef.current, 'toast.actionFailed', {
              e: e instanceof Error ? e.message : String(e),
            }),
          )
        }
        return null
      }
    },
    [toast],
  )

  const setCared = useCallback(
    async (modId: string, cared: boolean): Promise<void> => {
      // Optimistic: the toggle is a pure preference, so it must feel instant.
      // The server's state poke re-broadcasts the truth either way.
      let previous = cared
      setState(prev => {
        if (!prev) return prev
        return {
          ...prev,
          mods: prev.mods.map(m => {
            if (m.id !== modId) return m
            previous = m.cared // captured from live state, not the caller's closure
            return { ...m, cared }
          }),
        }
      })
      try {
        await api.setCared(modId, cared)
      } catch (e) {
        // Roll back to what it actually was: two fast toggles would otherwise
        // let the loser's rollback re-apply the winner's discarded value.
        setState(prev =>
          prev
            ? {
                ...prev,
                mods: prev.mods.map(m => (m.id === modId ? { ...m, cared: previous } : m)),
              }
            : prev,
        )
        toast(
          'error',
          translate(langRef.current, 'toast.actionFailed', {
            e: e instanceof Error ? e.message : String(e),
          }),
        )
      }
    },
    [toast],
  )

  /* ----- selectors ----- */
  const pendingCount = useMemo(
    () => state?.mods.filter(m => m.state === 'awaiting-steam').length ?? 0,
    [state],
  )

  const helperActive = state?.helperActive ?? false

  const value = useMemo<HubContextValue>(
    () => ({
      state,
      error,
      refresh,
      lang,
      setLang,
      t,
      themeMode,
      setThemeMode,
      route,
      navigate,
      openDetail,
      closeDetail,
      scope: route.game,
      setScope,
      sseConnected,
      helperActive,
      seq,
      feedPulse,
      actions,
      runAction,
      runSync,
      setCared,
      toasts,
      toast,
      dismissToast,
      pendingCount,
    }),
    [
      state,
      error,
      refresh,
      lang,
      setLang,
      t,
      themeMode,
      setThemeMode,
      route,
      navigate,
      openDetail,
      closeDetail,
      setScope,
      sseConnected,
      helperActive,
      seq,
      feedPulse,
      actions,
      runAction,
      runSync,
      setCared,
      toasts,
      toast,
      dismissToast,
      pendingCount,
    ],
  )

  return <HubContext.Provider value={value}>{children}</HubContext.Provider>
}

export function useHub(): HubContextValue {
  const ctx = useContext(HubContext)
  if (!ctx) throw new Error('useHub outside provider')
  return ctx
}
