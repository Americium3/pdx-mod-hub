import path from 'node:path'
import { readJson, writeJson } from './store.js'
import type { Settings } from './types.js'

export const ROOT = path.resolve(import.meta.dirname, '..', '..')
export const DATA_DIR = path.join(ROOT, 'data')
export const WEB_DIST = path.join(ROOT, 'web', 'dist')
export const HELPER_SCRIPT = path.join(ROOT, 'helper', 'steam_helper.js')

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

export const DEFAULT_SETTINGS: Settings = {
  port: 8768,
  pollIntervalMin: 5,
  changelogPrefetch: true,
  language: 'en',
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>(SETTINGS_FILE, {}) }
}

export function saveSettings(s: Settings): void {
  writeJson(SETTINGS_FILE, s)
}
