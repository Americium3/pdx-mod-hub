import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

/**
 * Geometry-mirroring shimmer block. Shows nothing for the first 150ms
 * so fast loads never flash a skeleton. No spinners on primary surfaces.
 */
export function Skeleton({
  width,
  height,
  radius,
  className,
  style,
}: {
  width?: number | string
  height?: number | string
  radius?: number | string
  className?: string
  style?: CSSProperties
}): ReactNode {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setShow(true), 150)
    return () => clearTimeout(timer)
  }, [])
  if (!show) return null
  return (
    <span
      className={`skeleton block ${className ?? ''}`}
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  )
}

/** Standard 8-row list skeleton mirroring 38px grid-table geometry. */
export function SkeletonRows({
  rows = 8,
  rowHeight = 38,
  className,
}: {
  rows?: number
  rowHeight?: number
  className?: string
}): ReactNode {
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-[16px] border-b border-[var(--line-div)] px-[16px]"
          style={{ height: rowHeight }}
        >
          <Skeleton width={64} height={22} radius={2} />
          <Skeleton width={`${34 - (i % 3) * 6}%`} height={12} radius={2} />
          <Skeleton width={72} height={10} radius={2} className="ml-auto" />
          <Skeleton width={48} height={10} radius={2} />
        </div>
      ))}
    </div>
  )
}
