import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, type ReactNode } from 'react'
import { TOAST_SPRING, useReducedMotionSafe } from '../motion'
import { useHub, type ToastItem, type ToastKind } from '../store'

const EDGE: Record<ToastKind, string> = {
  info: 'var(--state-downloading)',
  success: 'var(--state-fetched)',
  error: 'var(--state-error)',
  pending: 'var(--state-pending)',
}

function ToastCard({ item }: { item: ToastItem }): ReactNode {
  const { dismissToast } = useHub()

  useEffect(() => {
    const timer = setTimeout(() => dismissToast(item.id), item.ttl)
    return () => clearTimeout(timer)
  }, [item.id, item.ttl, dismissToast])

  return (
    <div
      className="pointer-events-auto relative w-[320px] cursor-pointer overflow-hidden rounded-std border border-[var(--line-1)] bg-[var(--bg-3)] py-[10px] pr-[12px] pl-[14px] text-[13px] text-[var(--text-1)]"
      style={{ boxShadow: 'var(--shadow-float)', borderLeft: `2px solid ${EDGE[item.kind]}` }}
      onClick={() => dismissToast(item.id)}
      role="status"
    >
      {item.text}
      {/* auto-dismiss progress hairline */}
      <span
        className="toast-hairline absolute bottom-0 left-0 h-[1px]"
        style={{ background: EDGE[item.kind], animationDuration: `${item.ttl}ms` }}
      />
    </div>
  )
}

/** Bottom-right toast host. Mount once in App. */
export function Toaster(): ReactNode {
  const { toasts } = useHub()
  const spring = useReducedMotionSafe(TOAST_SPRING)
  return (
    <div className="pointer-events-none fixed right-[16px] bottom-[16px] z-50 flex flex-col items-end gap-[8px]">
      <AnimatePresence>
        {toasts.map(item => (
          <motion.div
            key={item.id}
            layout
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12, transition: { duration: 0.12 } }}
            transition={spring}
          >
            <ToastCard item={item} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
