// Page-local toggle switch (no shared toggle primitive exists).
// Thumb glides on the SNAP spring per DESIGN_SPEC §7 ("toggle thumbs").
import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { SNAP, useReducedMotionSafe } from '../../motion'

export function Toggle({
  checked,
  onChange,
  disabled,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  'aria-label'?: string
}): ReactNode {
  const snap = useReducedMotionSafe(SNAP)
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[18px] w-[32px] shrink-0 cursor-pointer rounded-[9px] border transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 ${
        checked
          ? 'border-[var(--accent-fill-border)] bg-[var(--accent-fill)]'
          : 'border-[var(--line-2)] bg-[var(--inset)]'
      }`}
    >
      <motion.span
        animate={{ x: checked ? 14 : 0 }}
        transition={snap}
        className={`absolute top-[2px] left-[2px] block h-[12px] w-[12px] rounded-full ${
          checked ? 'bg-[var(--on-accent)]' : 'bg-[var(--text-3)]'
        }`}
      />
    </button>
  )
}
