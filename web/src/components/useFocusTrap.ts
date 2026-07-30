import { useEffect, type RefObject } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    el => el.offsetParent !== null || el === document.activeElement,
  )
}

/**
 * Focus management for an aria-modal overlay (must-fix 5): on open, save the
 * previously-focused element and move focus into the dialog; trap Tab / Shift+Tab
 * within the dialog's focusable descendants; on close/unmount, restore focus to
 * the saved element. Pass `initialFocus` to override the default (first focusable).
 */
export function useFocusTrap(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  initialFocus?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return undefined
    const root = ref.current
    const restoreTo = document.activeElement as HTMLElement | null

    // Move focus in after the entrance frame so the element exists / is visible.
    const focusTimer = setTimeout(() => {
      const target =
        initialFocus?.current ?? (root ? focusable(root)[0] : null) ?? root ?? null
      target?.focus()
    }, 0)

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const el = ref.current
      if (!el) return
      const items = focusable(el)
      if (items.length === 0) {
        e.preventDefault()
        el.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey) {
        if (active === first || !el.contains(active)) {
          e.preventDefault()
          last.focus()
        }
      } else if (active === last || !el.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)

    return () => {
      clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKey, true)
      // Restore focus to the trigger if it is still in the document.
      if (restoreTo && document.contains(restoreTo)) restoreTo.focus()
    }
  }, [open, ref, initialFocus])
}
