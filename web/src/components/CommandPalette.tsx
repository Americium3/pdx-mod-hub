import { AnimatePresence, motion } from 'framer-motion'
import { Activity, Compass, LibraryBig, Search, Settings } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import type { MsgKey } from '../i18n'
import { DUR } from '../motion'
import { useHub, type PageName } from '../store'
import { fuzzyScore } from '../util'
import { GamePill } from './GamePill'
import { KbdChip } from './KbdChip'

interface PaletteItem {
  id: string
  group: 'mods' | 'pages' | 'actions'
  label: string
  hint?: string
  appId?: number
  run: () => void
}

const PAGE_ICONS: Record<PageName, typeof Activity> = {
  updates: Activity,
  library: LibraryBig,
  browse: Compass,
  settings: Settings,
}

const GROUP_KEY: Record<PaletteItem['group'], MsgKey> = {
  mods: 'palette.mods',
  pages: 'palette.pages',
  actions: 'palette.actions',
}

/**
 * Ctrl/Cmd+K command palette: fuzzy mod search -> detail, nav jumps, and
 * global actions. Scale 0.98 -> 1 + fade, 130ms, from top-center origin.
 */
export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}): ReactNode {
  const { state, t, lang, setLang, themeMode, setThemeMode, navigate, openDetail, runSync, refresh, toast } =
    useHub()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      // focus after the entrance frame
      const timer = setTimeout(() => inputRef.current?.focus(), 30)
      return () => clearTimeout(timer)
    }
    return undefined
  }, [open])

  const items = useMemo<PaletteItem[]>(() => {
    if (!open) return []
    const list: PaletteItem[] = []

    const pages: PageName[] = ['updates', 'library', 'browse', 'settings']
    const pageKeys: Record<PageName, MsgKey> = {
      updates: 'nav.updates',
      library: 'nav.library',
      browse: 'nav.browse',
      settings: 'nav.settings',
    }
    for (const page of pages) {
      list.push({
        id: `page:${page}`,
        group: 'pages',
        label: t(pageKeys[page]),
        run: () => navigate({ page, mod: null }),
      })
    }

    const nextTheme = themeMode === 'auto' ? 'dark' : themeMode === 'dark' ? 'light' : 'auto'
    list.push(
      {
        id: 'act:check',
        group: 'actions',
        label: t('palette.checkNow'),
        run: () => {
          api
            .checkNow()
            .then(() => refresh())
            .catch(e => toast('error', t('toast.actionFailed', { e: String(e instanceof Error ? e.message : e) })))
        },
      },
      {
        id: 'act:sync',
        group: 'actions',
        label: t('palette.syncAll'),
        run: () => void runSync(),
      },
      {
        id: 'act:lang',
        group: 'actions',
        label: t('palette.switchLang'),
        run: () => setLang(lang === 'en' ? 'zh' : 'en'),
      },
      {
        id: 'act:theme',
        group: 'actions',
        label: `${t('palette.switchTheme')} → ${t(`theme.${nextTheme}` as MsgKey)}`,
        run: () => setThemeMode(nextTheme),
      },
    )

    for (const mod of state?.mods ?? []) {
      list.push({
        id: `mod:${mod.id}`,
        group: 'mods',
        label: mod.title,
        hint: mod.id,
        appId: mod.appId,
        run: () => openDetail(mod.id),
      })
    }
    return list
  }, [open, state, t, lang, themeMode, navigate, openDetail, runSync, refresh, setLang, setThemeMode, toast])

  const filtered = useMemo(() => {
    if (!query.trim()) {
      // Default view: pages + actions + first few mods.
      const head = items.filter(x => x.group !== 'mods')
      const mods = items.filter(x => x.group === 'mods').slice(0, 6)
      return [...head, ...mods]
    }
    const scored = items
      .map(item => {
        const target = item.hint ? `${item.label} ${item.hint}` : item.label
        const score = fuzzyScore(query, target)
        return score === null ? null : { item, score: score + (item.group === 'mods' ? 0 : 5) }
      })
      .filter((x): x is { item: PaletteItem; score: number } => x !== null)
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 24).map(x => x.item)
  }, [items, query])

  useEffect(() => {
    setCursor(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx='${cursor}']`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const execute = (item: PaletteItem | undefined): void => {
    if (!item) return
    onClose()
    item.run()
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(c + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      execute(filtered[cursor])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  let lastGroup: PaletteItem['group'] | null = null

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="palette-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: DUR.palette }}
          className="fixed inset-0 z-40 flex items-start justify-center bg-[rgba(0,0,0,0.4)] pt-[12vh]"
          onMouseDown={e => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <motion.div
            key="palette"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: DUR.palette }}
            style={{ transformOrigin: 'top center', boxShadow: 'var(--shadow-float)' }}
            className="w-[560px] max-w-[92vw] overflow-hidden rounded-std border border-[var(--line-1)] bg-[var(--bg-3)]"
            role="dialog"
            aria-modal="true"
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-[10px] border-b border-[var(--line-div)] px-[14px]">
              <Search size={16} strokeWidth={1.75} className="shrink-0 text-[var(--text-3)]" />
              <input
                ref={inputRef}
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={t('palette.placeholder')}
                className="h-[44px] w-full bg-transparent font-ui text-[13px] text-[var(--text-1)] placeholder:text-[var(--text-3)] outline-none"
              />
              <KbdChip>esc</KbdChip>
            </div>

            <div ref={listRef} className="max-h-[46vh] overflow-y-auto py-[6px]">
              {filtered.length === 0 ? (
                <div className="px-[16px] py-[18px] text-[13px] text-[var(--text-3)]">
                  {t('palette.noResults')}
                </div>
              ) : (
                filtered.map((item, idx) => {
                  const header = item.group !== lastGroup
                  lastGroup = item.group
                  const active = idx === cursor
                  const Icon =
                    item.group === 'pages'
                      ? PAGE_ICONS[item.id.slice(5) as PageName]
                      : undefined
                  return (
                    <div key={item.id}>
                      {header ? (
                        <div className="voice-label px-[16px] pt-[8px] pb-[4px]">
                          {t(GROUP_KEY[item.group])}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        data-idx={idx}
                        onMouseEnter={() => setCursor(idx)}
                        onClick={() => execute(item)}
                        className={`flex h-[34px] w-full cursor-pointer items-center gap-[10px] px-[16px] text-left text-[13px] ${active ? 'bg-[var(--accent-tint)] text-[var(--text-1)]' : 'text-[var(--text-2)]'}`}
                      >
                        {Icon ? <Icon size={16} strokeWidth={1.75} className="shrink-0 text-[var(--text-3)]" /> : null}
                        {item.appId !== undefined ? <GamePill appId={item.appId} /> : null}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        {item.hint ? (
                          <span className="voice-mono-sm shrink-0 text-[var(--text-3)]">{item.hint}</span>
                        ) : null}
                      </button>
                    </div>
                  )
                })
              )}
            </div>

            <div className="flex items-center justify-end border-t border-[var(--line-div)] px-[14px] py-[6px]">
              <span className="voice-mono-sm text-[var(--text-3)]">{t('palette.hint')}</span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
