import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { MOVE, useReducedMotionSafe } from '../motion'
import { useHub } from '../store'
import { useFocusTrap } from './useFocusTrap'

/**
 * DETAIL SHEET shell: right sheet, 560px, floats over any page with a real
 * shadow in both themes. Slides in with MOVE; closes on Esc / scrim click.
 * Content is provided by the detail module (children).
 */
export function DetailSheetShell({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children?: ReactNode
}): ReactNode {
  const { t } = useHub()
  const move = useReducedMotionSafe(MOVE)
  const sheetRef = useRef<HTMLElement>(null)
  useFocusTrap(open, sheetRef)

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="sheet-scrim"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
          className="fixed inset-0 z-30 bg-[rgba(0,0,0,0.35)]"
          onMouseDown={e => {
            if (e.target === e.currentTarget) onClose()
          }}
        >
          <motion.aside
            key="sheet"
            ref={sheetRef}
            tabIndex={-1}
            initial={{ x: 560 }}
            animate={{ x: 0 }}
            exit={{ x: 560, transition: { duration: 0.16, ease: 'easeIn' } }}
            transition={move}
            style={{ boxShadow: 'var(--shadow-float)' }}
            className="absolute top-0 right-0 flex h-full w-[560px] max-w-[94vw] flex-col border-l border-[var(--line-1)] bg-[var(--bg-1)] outline-none"
            role="dialog"
            aria-modal="true"
            onMouseDown={e => e.stopPropagation()}
          >
            <div className="flex h-[40px] shrink-0 items-center justify-between gap-[12px] border-b border-[var(--line-div)] pr-[8px] pl-[16px]">
              <div className="voice-label min-w-0 truncate">{title ?? t('detail.title')}</div>
              <button
                type="button"
                onClick={onClose}
                title={t('detail.close')}
                className="flex h-[28px] w-[28px] cursor-pointer items-center justify-center rounded-std text-[var(--text-2)] hover:bg-[var(--bg-2)] hover:text-[var(--text-1)]"
              >
                <X size={16} strokeWidth={1.75} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
