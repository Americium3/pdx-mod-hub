// Page-local hooks: viewport breakpoint + lazy in-view detection.
import { useEffect, useRef, useState, type RefObject } from 'react'

/** True at >=1400px — the launch-queue strip becomes a sticky right sidebar. */
export function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1400px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1400px)')
    const onChange = (): void => setWide(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return wide
}

/**
 * One-shot IntersectionObserver visibility: flips true the first time the
 * element scrolls into view and stays true (drives lazy changelog fetches).
 */
export function useInView(ref: RefObject<Element | null>, rootMargin = '200px'): boolean {
  const [inView, setInView] = useState(false)
  const seen = useRef(false)
  useEffect(() => {
    if (seen.current) return
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') {
      seen.current = true
      setInView(true)
      return
    }
    const obs = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          seen.current = true
          setInView(true)
          obs.disconnect()
        }
      },
      { rootMargin },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [ref, rootMargin])
  return inView
}
