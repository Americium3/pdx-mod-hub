import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ModState } from '../types'

export type SpineState =
  | 'awaiting' // amber breathing (unseen)
  | 'queued' // amber-dim static (queued-for-launch)
  | 'downloading' // cyan indeterminate vertical sweep
  | 'fetched' // green
  | 'error'
  | 'orphaned'
  | 'none'

export function spineStateOf(state: ModState): SpineState {
  switch (state) {
    case 'awaiting-steam':
      return 'awaiting'
    case 'queued-for-launch':
      return 'queued'
    case 'downloading':
      return 'downloading'
    case 'up-to-date':
      return 'fetched'
    case 'removed':
    case 'banned':
    case 'error':
      return 'error'
    case 'orphaned':
    case 'unverified':
      return 'orphaned'
    default:
      return 'none'
  }
}

/** The 3px left-edge state narrative. Pair with useMoneyMoment on feed cards. */
export function Spine({
  state,
  sweeping = false,
  className,
}: {
  state: SpineState
  /** money-moment beat 1: amber -> green top-to-bottom wipe (400ms) */
  sweeping?: boolean
  className?: string
}): ReactNode {
  if (state === 'none' && !sweeping) return null
  return (
    <span
      className={`spine ${sweeping ? 'spine-sweep-green' : ''} ${className ?? ''}`}
      data-state={state}
      aria-hidden="true"
    />
  )
}

export interface MoneyMoment {
  /** current spine state to render (holds amber during the wipe) */
  spineState: SpineState
  /** beat 1 flag for <Spine sweeping> */
  sweeping: boolean
  /** beat 2: stamp may crossfade to FETCHED once true */
  stampFlipped: boolean
  /** beat 3: put .money-ring on the card while true — the app's only glow */
  ringing: boolean
  /** beat 4 + general: brackets visible while the update is still unseen */
  bracketsVisible: boolean
  celebrating: boolean
}

const SWEEP_MS = 400
const STAMP_AT_MS = 120
const RING_AT_MS = 400
const RING_MS = 600

/**
 * The 4-beat ~700ms pending->fetched sequence (DESIGN_SPEC §7), driven by a
 * ModState transition observed via SSE/fs.watch: (1) spine sweeps amber->green,
 * (2) stamp crossfades + check draws, (3) ONE green ring pulse, (4) brackets
 * scale out. Reduced motion: everything snaps instantly.
 */
export function useMoneyMoment(state: ModState): MoneyMoment {
  const target = spineStateOf(state)
  const wasPending =
    useRef<boolean>(state === 'awaiting-steam' || state === 'queued-for-launch' || state === 'downloading')
  const [celebrating, setCelebrating] = useState(false)
  const [sweeping, setSweeping] = useState(false)
  const [stampFlipped, setStampFlipped] = useState(target === 'fetched')
  const [ringing, setRinging] = useState(false)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const pendingNow =
      state === 'awaiting-steam' || state === 'queued-for-launch' || state === 'downloading'
    const fetchedNow = state === 'up-to-date'
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (wasPending.current && fetchedNow) {
      if (reduced) {
        // Instant color + stamp swap.
        setStampFlipped(true)
        setCelebrating(false)
      } else {
        setCelebrating(true)
        setSweeping(true)
        timers.current.push(setTimeout(() => setStampFlipped(true), STAMP_AT_MS))
        timers.current.push(setTimeout(() => setRinging(true), RING_AT_MS))
        timers.current.push(setTimeout(() => setSweeping(false), SWEEP_MS))
        timers.current.push(
          setTimeout(() => {
            setRinging(false)
            setCelebrating(false)
          }, RING_AT_MS + RING_MS),
        )
      }
    } else {
      setStampFlipped(fetchedNow)
    }
    wasPending.current = pendingNow
    return () => {
      for (const timer of timers.current) clearTimeout(timer)
      timers.current = []
    }
  }, [state])

  return {
    spineState: sweeping ? 'awaiting' : target,
    sweeping,
    stampFlipped,
    ringing,
    bracketsVisible: state === 'awaiting-steam',
    celebrating,
  }
}
