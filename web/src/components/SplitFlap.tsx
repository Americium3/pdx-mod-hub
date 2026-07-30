import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * Split-flap readout: per-character translateY odometer roll (180ms), rolling
 * ONLY the characters that changed — never per-second ambience. Used by the
 * POLL countdown (10s granularity) and live counters.
 */
export function SplitFlap({ text, className }: { text: string; className?: string }): ReactNode {
  const reduced = useReducedMotion()
  const chars = Array.from(text)
  if (reduced) {
    // Hard swap under reduced motion.
    return <span className={className}>{text}</span>
  }
  return (
    <span className={`inline-flex ${className ?? ''}`} aria-label={text}>
      {chars.map((ch, i) => (
        <span key={i} className="flap-cell">
          {/* invisible sizer keeps cell width while flaps animate absolutely */}
          <span className="invisible">{ch}</span>
          <AnimatePresence initial={false}>
            <motion.span
              key={ch}
              initial={{ y: '-100%' }}
              animate={{ y: '0%' }}
              exit={{ y: '100%' }}
              transition={{ duration: 0.18, ease: 'easeInOut' }}
              className="absolute inset-0"
            >
              {ch}
            </motion.span>
          </AnimatePresence>
        </span>
      ))}
    </span>
  )
}
