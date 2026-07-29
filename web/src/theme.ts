// Three-state theme: auto (follows OS) / dark / light.
// Applied as data-theme="dark|light" on <html>; CSS variables switch on it.
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
  document.documentElement.dataset.theme = resolveTheme(mode)
}

export function saveThemeMode(mode: ThemeMode): void {
  localStorage.setItem(KEY, mode)
  applyTheme(mode)
}

// Re-apply on OS theme change while in auto mode.
export function watchSystemTheme(getMode: () => ThemeMode): () => void {
  const onChange = (): void => {
    if (getMode() === 'auto') applyTheme('auto')
  }
  mql.addEventListener('change', onChange)
  return () => mql.removeEventListener('change', onChange)
}
