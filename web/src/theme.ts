// Three-state theme: auto (follows OS) / dark / light.
// Applied as data-theme="dark|light" + color-scheme on <html>; the CSS
// variable sheet switches on it. Mirrors the pre-paint script in
// public/theme-init.js.
export type ThemeMode = 'auto' | 'dark' | 'light'

const KEY = 'pmh.theme'
const mql = window.matchMedia('(prefers-color-scheme: dark)')

export function loadThemeMode(): ThemeMode {
  const saved = localStorage.getItem(KEY)
  return saved === 'dark' || saved === 'light' ? saved : 'auto'
}

export function resolveTheme(mode: ThemeMode): 'dark' | 'light' {
  if (mode === 'auto') return mql.matches ? 'dark' : 'light'
  return mode
}

export function applyTheme(mode: ThemeMode): void {
  const theme = resolveTheme(mode)
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
}

/** ~200ms View Transitions crossfade when available; instant under reduced motion. */
export function applyThemeWithTransition(mode: ThemeMode): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (typeof doc.startViewTransition === 'function' && !reduced) {
    doc.startViewTransition(() => applyTheme(mode))
  } else {
    applyTheme(mode)
  }
}

export function saveThemeMode(mode: ThemeMode): void {
  localStorage.setItem(KEY, mode)
  applyThemeWithTransition(mode)
}

// Re-apply on OS theme change while in auto mode.
export function watchSystemTheme(getMode: () => ThemeMode): () => void {
  const onChange = (): void => {
    if (getMode() === 'auto') applyTheme('auto')
  }
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}
