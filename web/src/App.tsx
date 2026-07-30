import { motion } from 'framer-motion'
import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { CommandRail } from './components/CommandRail'
import { OpsBar } from './components/OpsBar'
import { SkeletonRows } from './components/Skeleton'
import { Toaster } from './components/Toast'
import DetailSheet from './detail/DetailSheet'
import type { MsgKey } from './i18n'
import { DUR } from './motion'
import { useHub, type PageName } from './store'

// Route content is lazy per page (page agents own these modules).
const UpdatesPage = lazy(() => import('./pages/updates/index'))
const LibraryPage = lazy(() => import('./pages/library/index'))
const BrowsePage = lazy(() => import('./pages/browse/index'))
const SettingsPage = lazy(() => import('./pages/settings/index'))

const TITLE_KEY: Record<PageName, MsgKey> = {
  updates: 'nav.updates',
  library: 'nav.library',
  browse: 'nav.browse',
  settings: 'nav.settings',
}

function PageBody({ page }: { page: PageName }): ReactNode {
  switch (page) {
    case 'updates':
      return <UpdatesPage />
    case 'library':
      return <LibraryPage />
    case 'browse':
      return <BrowsePage />
    case 'settings':
      return <SettingsPage />
  }
}

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export default function App(): ReactNode {
  const { route, closeDetail } = useHub()
  const [paletteOpen, setPaletteOpen] = useState(false)

  // Global keys: Ctrl/Cmd+K palette, '/' focuses page search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen(open => !open)
        return
      }
      if (e.key === '/' && !isEditable(e.target) && !paletteOpen) {
        // Pages listen for this to focus their own search input.
        const handled = window.dispatchEvent(new CustomEvent('pmh:focus-search', { cancelable: true }))
        if (!handled) e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paletteOpen])

  const closePalette = useCallback(() => setPaletteOpen(false), [])

  return (
    <div className="flex h-full overflow-hidden">
      <CommandRail />

      <div className="flex h-full min-w-0 flex-1 flex-col">
        <OpsBar titleKey={TITLE_KEY[route.page]} onPalette={() => setPaletteOpen(true)} />

        <main className="reg-tick relative min-h-0 flex-1 overflow-y-auto">
          {/* Route transition: fade + 4px translateY, <=140ms, entrance only. */}
          <motion.div
            key={route.page}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.route, ease: 'easeOut' }}
            className="min-h-full"
          >
            <Suspense
              fallback={
                <div className="px-[24px] py-[20px]">
                  <SkeletonRows rows={8} />
                </div>
              }
            >
              <PageBody page={route.page} />
            </Suspense>
          </motion.div>
        </main>
      </div>

      {/* Overlays */}
      <DetailSheet modId={route.mod} onClose={closeDetail} />
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <Toaster />
    </div>
  )
}
