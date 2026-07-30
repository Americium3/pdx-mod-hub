import { useState, type CSSProperties, type ReactNode } from 'react'
import { img } from '../api'
import { gameShort, modInitials } from '../util'

/**
 * Every image slot keeps a DARK base behind the art in BOTH themes; the bottom
 * scrim is always dark ("art is a window into the night side"). Light mode adds
 * a mandatory 1px border. Rest state is desaturated and wakes on hover (220ms).
 * Broken/missing art renders a deterministic fallback tile — never a broken box.
 */
export function ImageFrame({
  src,
  alt = '',
  aspect = '2.14 / 1',
  appId,
  gameName,
  title = '',
  scrim = false,
  wake = true,
  maxHeight,
  className,
  children,
}: {
  /** raw Steam URL — routed through /api/img automatically */
  src?: string | null
  alt?: string
  /** CSS aspect-ratio value; Steam capsules are 460x215 = 2.14:1 */
  aspect?: string
  appId: number
  gameName?: string
  title?: string
  /** dark bottom scrim for text-over-art (always dark, both themes) */
  scrim?: boolean
  /** desat rest-state waking on hover */
  wake?: boolean
  maxHeight?: number
  className?: string
  /** content over the art (titles, pills) — always light-on-dark */
  children?: ReactNode
}): ReactNode {
  const [broken, setBroken] = useState(false)
  const proxied = img(src)
  const showFallback = !proxied || broken

  const frameStyle: CSSProperties = {
    aspectRatio: aspect,
    background: 'var(--img-base)',
    border: '1px solid var(--img-border)',
    ...(maxHeight !== undefined ? { maxHeight } : {}),
  }

  return (
    <div
      className={`relative w-full overflow-hidden rounded-std ${wake ? 'img-wake' : ''} ${className ?? ''}`}
      style={frameStyle}
    >
      {showFallback ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-[4px] bg-[var(--bg-2)]">
          <span className="font-label text-[11px] font-semibold tracking-[0.08em] text-[var(--text-3)] uppercase">
            {gameShort(appId, gameName)}
          </span>
          <span className="font-label text-[20px] font-semibold tracking-[0.04em] text-[var(--text-3)] uppercase">
            {modInitials(title)}
          </span>
        </div>
      ) : (
        <img
          src={proxied}
          alt={alt}
          loading="lazy"
          onError={() => setBroken(true)}
          className={`absolute inset-0 h-full w-full object-cover ${wake ? 'img-rest' : ''}`}
          draggable={false}
        />
      )}
      {scrim ? (
        <div className="pointer-events-none absolute inset-0" style={{ background: 'var(--scrim)' }} />
      ) : null}
      {children ? <div className="absolute inset-0">{children}</div> : null}
    </div>
  )
}
