import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { DUR } from '../motion'

const CORNERS = [
  { top: 4, left: 4, borderWidth: '1.5px 0 0 1.5px' },
  { top: 4, right: 4, borderWidth: '1.5px 1.5px 0 0' },
  { bottom: 4, left: 4, borderWidth: '0 0 1.5px 1.5px' },
  { bottom: 4, right: 4, borderWidth: '0 1.5px 1.5px 0' },
] as const

/**
 * ACQUISITION BRACKETS: four 8x8px 1.5px-stroke --accent-graphic corner
 * brackets on pending (unseen) card heroes only. On fetch they scale
 * 1 -> 1.1 and fade out over 200ms (money-moment beat 4).
 */
export function Brackets({ show }: { show: boolean }): ReactNode {
  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          className="pointer-events-none absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.1 }}
          transition={{ duration: DUR.bracketFade }}
          aria-hidden="true"
        >
          {CORNERS.map((c, i) => (
            <span
              key={i}
              className="absolute h-[8px] w-[8px]"
              style={{
                ...('left' in c ? { left: c.left } : {}),
                ...('right' in c ? { right: c.right } : {}),
                ...('top' in c ? { top: c.top } : {}),
                ...('bottom' in c ? { bottom: c.bottom } : {}),
                borderStyle: 'solid',
                borderColor: 'var(--accent-graphic)',
                borderWidth: c.borderWidth,
              }}
            />
          ))}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
