import type { ReactNode } from 'react'
import { gameColor, gameShort } from '../util'

/**
 * The only pills allowed in the app: bordered per-game tags —
 * heraldic hue text + border, no fill. `onArt` keeps the dark-theme hue over
 * Steam art in both themes (the art under it is always dark).
 */
export function GamePill({
  appId,
  name,
  onArt = false,
  className,
}: {
  appId: number
  name?: string
  onArt?: boolean
  className?: string
}): ReactNode {
  const color = gameColor(appId, name)
  return (
    <span
      className={`inline-flex items-center rounded-chip border px-[6px] py-[1px] font-mono text-[11px] leading-[16px] whitespace-nowrap ${onArt ? 'night-side' : ''} ${className ?? ''}`}
      style={{ borderColor: color, color }}
    >
      {gameShort(appId, name)}
    </span>
  )
}

/** Rail/group-header glyph: small heraldic-bordered square with the game code initial. */
export function GameGlyph({
  appId,
  name,
  size = 16,
  className,
}: {
  appId: number
  name?: string
  size?: number
  className?: string
}): ReactNode {
  const color = gameColor(appId, name)
  const code = gameShort(appId, name)
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-chip border font-label font-semibold ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        borderColor: color,
        color,
        fontSize: Math.round(size * 0.5),
        letterSpacing: 0,
      }}
      aria-hidden="true"
    >
      {code.slice(0, 1)}
    </span>
  )
}

/** Neutral targets pill: "1.7–1.9" mono — a fact, never a verdict. */
export function TargetsPill({
  min,
  max,
  className,
}: {
  min: string
  max: string
  className?: string
}): ReactNode {
  return (
    <span
      className={`inline-flex items-center rounded-chip border border-[var(--line-2)] px-[6px] py-[1px] font-mono text-[11px] leading-[16px] text-[var(--text-2)] tabular ${className ?? ''}`}
    >
      {min === max ? min : `${min}–${max}`}
    </span>
  )
}
