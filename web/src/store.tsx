import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api, connectEvents } from './api'
import type { Lang, MsgKey } from './i18n'
import { translate } from './i18n'
import type { HubState } from './types'

interface HubContextValue {
  state: HubState | null
  error: string | null
  refresh: () => Promise<void>
  lang: Lang
  setLang: (lang: Lang) => void
  t: (key: MsgKey, vars?: Record<string, string | number>) => string
  helperBusy: boolean
}

const HubContext = createContext<HubContextValue | null>(null)

export function HubProvider({ children }: { children: ReactNode }): ReactNode {
  const [state, setState] = useState<HubState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [helperBusy, setHelperBusy] = useState(false)
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem('pmh.lang')
    return saved === 'zh' ? 'zh' : 'en'
  })
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await api.state()
      setState(next)
      setError(null)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }, [])

  // Debounce bursts of SSE refresh events into one state fetch.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => void refresh(), 350)
  }, [refresh])

  useEffect(() => {
    void refresh()
    const close = connectEvents((event, data) => {
      if (event === 'helper') {
        setHelperBusy(Boolean(data.busy))
        return
      }
      scheduleRefresh()
    })
    return close
  }, [refresh, scheduleRefresh])

  useEffect(() => {
    if (state && state.settings.language !== lang) {
      // Keep the server-side default in sync so both ends agree after restart.
      void api.saveSettings({ language: lang }).catch(() => undefined)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem('pmh.lang', next)
    setLangState(next)
  }, [])

  const t = useCallback(
    (key: MsgKey, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  )

  return (
    <HubContext.Provider value={{ state, error, refresh, lang, setLang, t, helperBusy }}>
      {children}
    </HubContext.Provider>
  )
}

export function useHub(): HubContextValue {
  const ctx = useContext(HubContext)
  if (!ctx) throw new Error('useHub outside provider')
  return ctx
}
