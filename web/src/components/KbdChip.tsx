import type { ReactNode } from 'react'

/** Visible keyboard hint: 1px-bordered 11px mono chip. */
export function KbdChip({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}): ReactNode {
  return (
    <kbd
      className={`inline-flex h-[18px] items-center rounded-chip border border-[var(--line-2)] px-[5px] font-mono text-[11px] leading-none text-[var(--text-3)] ${className ?? ''}`}
    >
      {children}
    </kbd>
  )
}
