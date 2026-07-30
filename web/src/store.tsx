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
  runAction: (
    kind: Extract<ActionKind, 'subscribe' | 'unsubscribe' | 'download'>,
    payload: { appId: number; modId?: string; modIds?: string[] },
  ) => Promise<string | null>
  runSync: (appId?: number) => Promise<string | null>

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

  useEffect(() => {
    void refresh()
    const close = connectEvents({
      onPoke,
      onOpen: () => {
        setSseConnected(true)
        // Reconnect contract: refetch state; pages catch feed up via after_seq.
        void refresh()
        setFeedPulse(p => p + 1)
      },
      onDown: () => setSseConnected(false),
    })
    return close
  }, [refresh, onPoke])

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
      kind: Extract<ActionKind, 'subscribe' | 'unsubscribe' | 'download'>,
      payload: { appId: number; modId?: string; modIds?: string[] },
    ): Promise<string | null> => {
      try {
        const { actionId } = await api.action(kind, payload)
        setActions(prev => ({
          ...prev,
          [actionId]: {
            actionId,
            kind,
            stage: 'queued',
            appId: payload.appId,
            modId: payload.modId,
            modIds: payload.modIds,
            startedAt: Date.now(),
          },
        }))
        return actionId
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
