import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { SNAP, useReducedMotionSafe } from '../motion'
import { useHub } from '../store'
import type { ThemeMode } from '../theme'

const SEGMENTS: { mode: ThemeMode; glyph: string }[] = [
  { mode: 'auto', glyph: '◐' },
  { mode: 'dark', glyph: '●' },
  { mode: 'light', glyph: '○' },
]

/**
 * Compact 3-segment theme control: ◐ auto / ● dark / ○ light, 3 x 28px,
 * accent-tinted pill sliding between segments via layoutId + SNAP.
 * Lives in the ops-bar right cluster; duplicated as a labeled row in Settings.
 */
export function ThemeControl({ layoutIdSuffix = 'ops' }: { layoutIdSuffix?: string }): ReactNode {
  const { themeMode, setThemeMode, t } = useHub()
  const snap = useReducedMotionSafe(SNAP)
  const titles: Record<ThemeMode, string> = {
    auto: t('theme.auto'),
    dark: t('theme.dark'),
    light: t('theme.light'),
  }
  return (
    <div
      className="flex h-[28px] items-center rounded-std border border-[var(--line-1)]"
      role="radiogroup"
      aria-label={t('settings.theme')}
    >
      {SEGMENTS.map(seg => {
        const active = themeMode === seg.mode
        return (
          <button
            key={seg.mode}
            type="button"
            role="radio"
            aria-checked={active}
            title={titles[seg.mode]}
            onClick={() => setThemeMode(seg.mode)}
            className={`relative flex h-[28px] w-[28px] items-center justify-center text-[12px] leading-none ${active ? 'text-[var(--accent-text)]' : 'text-[var(--text-3)] hover:text-[var(--text-2)]'}`}
          >
            {active ? (
              <motion.span
                layoutId={`theme-pill-${layoutIdSuffix}`}
                transition={snap}
                className="absolute inset-[2px] rounded-chip bg-[var(--accent-tint)]"
              />
            ) : null}
            <span className="relative">{seg.glyph}</span>
          </button>
        )
      })}
    </div>
  )
}
