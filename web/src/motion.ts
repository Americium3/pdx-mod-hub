// GROUND STATION motion tokens (DESIGN_SPEC §7).
// Four named springs — nothing ad-hoc. Every animated component imports these.
import { useReducedMotion } from 'framer-motion'
import type { Transition } from 'framer-motion'

/** Button/row press physics, toggle thumbs, nav pill, badge pops. */
export const SNAP: Transition = { type: 'spring', stiffness: 600, damping: 32, mass: 0.7 }

/** FLIP/layout glides, tray slide-up, continuous progress interpolation. */
export const MOVE: Transition = { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 }

/** Changelog height:auto expansion (collapse is a 200ms ease-in tween). */
export const EXPAND: Transition = { type: 'spring', stiffness: 280, damping: 30 }

/** The stamp thunk: punch-in on NEW SSE update-event arrival only. */
export const STAMP: Transition = { type: 'spring', stiffness: 600, damping: 22 }

/** Toast x-entrance spring per spec ("x 12px spring {480,38}"). */
export const TOAST_SPRING: Transition = { type: 'spring', stiffness: 480, damping: 38 }

/** Duration constants (seconds, framer units). Micro 80–220ms; page-level <=140ms. */
export const DUR = {
  micro: 0.08,
  rowHover: 0.08,
  stampSwap: 0.12,
  palette: 0.13,
  route: 0.14,
  actionReveal: 0.15,
  bracketFade: 0.2,
  collapse: 0.2,
  artWake: 0.22,
  checkDraw: 0.26,
  stampThunk: 0.38,
  spineSweep: 0.4,
  radarSpin: 0.6,
  ringPulse: 0.6,
  cascadeStep: 0.12,
  feedStagger: 0.04,
} as const

/** The reduced-motion replacement: an 80ms opacity-only tween. */
export const REDUCED_TWEEN: Transition = { duration: 0.08, ease: 'linear' }

/**
 * Swap any named spring for the 80ms opacity tween under
 * prefers-reduced-motion. Usage: transition={useReducedMotionSafe(SNAP)}.
 */
export function useReducedMotionSafe(transition: Transition): Transition {
  const reduced = useReducedMotion()
  return reduced ? REDUCED_TWEEN : transition
}

/** Non-hook variant for places that already know the flag. */
export function motionSafe(transition: Transition, reduced: boolean | null): Transition {
  return reduced ? REDUCED_TWEEN : transition
}
