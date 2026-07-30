import { motion } from 'framer-motion'
import {
  Activity,
  ChevronsLeft,
  ChevronsRight,
  Compass,
  LibraryBig,
  Radar,
  Settings,
} from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import type { MsgKey } from '../i18n'
import { MOVE, SNAP, useReducedMotionSafe } from '../motion'
import { useHub, type PageName } from '../store'
import { gameColor } from '../util'
import { GameGlyph } from './GamePill'
import { ReservedPair, ReservedText } from './ReservedText'

const RAIL_KEY = 'pmh.rail'

const NAV: { page: PageName; key: MsgKey; icon: typeof Activity }[] = [
  { page: 'updates', key: 'nav.updates', icon: Activity },
  { page: 'library', key: 'nav.library', icon: LibraryBig },
  { page: 'browse', key: 'nav.browse', icon: Compass },
  { page: 'settings', key: 'nav.settings', icon: Settings },
]

/**
 * Fixed left COMMAND RAIL: 232px, collapsible to a 56px icon rail (persisted).
 * Nav pill slides via layoutId + SNAP; GAMES section scopes Library/Browse.
 */
export function CommandRail(): ReactNode {
  const { state, t, lang, setLang, route, navigate, pendingCount } = useHub()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(RAIL_KEY) === '1')
  const snap = useReducedMotionSafe(SNAP)
  const move = useReducedMotionSafe(MOVE)

  const toggle = (): void => {
    setCollapsed(prev => {
      localStorage.setItem(RAIL_KEY, prev ? '0' : '1')
      return !prev
    })
  }

  const counts = useMemo(() => {
    const map = new Map<number, number>()
    for (const mod of state?.mods ?? []) map.set(mod.appId, (map.get(mod.appId) ?? 0) + 1)
    return map
  }, [state])

  const games = useMemo(() => {
    const list = (state?.games ?? []).filter(g => g.installed)
    return [...list].sort((a, b) => a.name.localeCompare(b.name))
  }, [state])

  const scopeGame = (appId: number): void => {
    const nextGame = route.game === appId ? null : appId
    const page = route.page === 'browse' ? 'browse' : 'library'
    navigate({ page, game: nextGame, mod: null })
  }

  return (
    <motion.nav
      animate={{ width: collapsed ? 56 : 232 }}
      transition={move}
      initial={false}
      className="relative z-10 flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--line-1)] bg-[var(--bg-1)]"
      aria-label="Command rail"
    >
      {/* Wordmark */}
      <div className="flex h-[48px] shrink-0 items-center gap-[10px] px-[18px]">
        <Radar size={18} strokeWidth={1.75} className="shrink-0 text-[var(--accent-graphic)]" />
        {!collapsed ? (
          <span className="font-label text-[12px] font-semibold tracking-[0.08em] whitespace-nowrap text-[var(--text-1)] uppercase">
            {t('rail.wordmark')}
          </span>
        ) : null}
      </div>

      {/* Nav */}
      <div className="flex flex-col gap-[2px] px-[8px]">
        {NAV.map(item => {
          const active = route.page === item.page
          const Icon = item.icon
          return (
            <motion.button
              key={item.page}
              type="button"
              whileTap={{ scale: 0.985 }}
              transition={snap}
              onClick={() => navigate({ page: item.page, mod: null })}
              className={`relative flex h-[36px] cursor-pointer items-center gap-[10px] rounded-std px-[10px] text-[13px] font-medium whitespace-nowrap ${active ? 'text-[var(--accent-text)]' : 'text-[var(--text-2)] hover:bg-[var(--bg-2)] hover:text-[var(--text-1)]'}`}
              title={t(item.key)}
            >
              {active ? (
                <motion.span
                  layoutId="nav-pill"
                  transition={snap}
                  className="absolute inset-0 rounded-std bg-[var(--accent-tint)]"
                />
              ) : null}
              <Icon size={18} strokeWidth={1.75} className="relative shrink-0" />
              {!collapsed ? (
                <span className="relative flex min-w-0 flex-1 items-center justify-between">
                  <ReservedText k={item.key} />
                  {item.page === 'updates' && pendingCount > 0 ? (
                    <span className="voice-mono-sm rounded-chip border border-[var(--state-pending)] px-[5px] text-[var(--state-pending)]">
                      {pendingCount}
                    </span>
                  ) : null}
                </span>
              ) : item.page === 'updates' && pendingCount > 0 ? (
                <span className="absolute top-[6px] right-[6px] h-[6px] w-[6px] rounded-full bg-[var(--state-pending)]" />
              ) : null}
            </motion.button>
          )
        })}
      </div>

      {/* GAMES scoping list */}
      <div className="mt-[18px] flex min-h-0 flex-1 flex-col overflow-y-auto px-[8px] pb-[8px]">
        {!collapsed ? (
          <div className="voice-label px-[10px] pb-[6px]">
            <ReservedText k="rail.games" />
          </div>
        ) : (
          <div className="mb-[6px] border-t border-[var(--line-div)]" />
        )}
        {games.map(game => {
          const active = route.game === game.appId
          const count = game.modCount ?? counts.get(game.appId) ?? 0
          return (
            <motion.button
              key={game.appId}
              type="button"
              whileTap={{ scale: 0.985 }}
              transition={snap}
              onClick={() => scopeGame(game.appId)}
              title={`${game.name} · ${count}`}
              className={`flex h-[32px] cursor-pointer items-center gap-[10px] rounded-std px-[10px] whitespace-nowrap ${active ? 'bg-[var(--accent-tint)]' : 'hover:bg-[var(--bg-2)]'} ${game.libraryOffline ? 'opacity-50' : ''}`}
            >
              <GameGlyph appId={game.appId} name={game.name} />
              {!collapsed ? (
                <>
                  <span
                    className={`min-w-0 flex-1 truncate text-left text-[13px] ${active ? 'text-[var(--text-1)]' : 'text-[var(--text-2)]'}`}
                    style={active ? { color: gameColor(game.appId, game.name) } : undefined}
                  >
                    {game.name}
                  </span>
                  <span className="voice-mono-sm text-[var(--text-3)]">{count}</span>
                </>
              ) : null}
            </motion.button>
          )
        })}
      </div>

      {/* Footer: EN/中 toggle + collapse */}
      <div className="flex shrink-0 items-center justify-between gap-[6px] border-t border-[var(--line-div)] px-[10px] py-[8px]">
        {!collapsed ? (
          <div className="flex h-[24px] items-center rounded-std border border-[var(--line-1)]">
            {(['en', 'zh'] as const).map(code => {
              const active = lang === code
              return (
                <button
                  key={code}
                  type="button"
                  onClick={() => setLang(code)}
                  className={`relative flex h-[24px] cursor-pointer items-center px-[8px] font-mono text-[11px] ${active ? 'text-[var(--accent-text)]' : 'text-[var(--text-3)] hover:text-[var(--text-2)]'}`}
                >
                  {active ? (
                    <motion.span
                      layoutId="lang-pill"
                      transition={snap}
                      className="absolute inset-[2px] rounded-chip bg-[var(--accent-tint)]"
                    />
                  ) : null}
                  <span className="relative">
                    <ReservedPair a="EN" b="中" active={code === 'en' ? 'EN' : '中'} />
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? t('rail.expand') : t('rail.collapse')}
          className="flex h-[24px] w-[24px] cursor-pointer items-center justify-center rounded-std text-[var(--text-3)] hover:bg-[var(--bg-2)] hover:text-[var(--text-1)]"
        >
          {collapsed ? (
            <ChevronsRight size={16} strokeWidth={1.75} />
          ) : (
            <ChevronsLeft size={16} strokeWidth={1.75} />
          )}
        </button>
      </div>
    </motion.nav>
  )
}
