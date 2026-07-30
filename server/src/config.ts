import path from 'node:path'
import { readJson, writeJson } from './store.js'
import type { Settings } from './types.js'

export const ROOT = path.resolve(import.meta.dirname, '..', '..')
export const DATA_DIR = path.join(ROOT, 'data')
export const WEB_DIST = path.join(ROOT, 'web', 'dist')
export const HELPER_SCRIPT = path.join(ROOT, 'helper', 'steam_helper.js')

export const APP_NAME = 'pdx-mod-hub'
export const APP_VERSION: string =
  readJson<{ version?: string }>(path.join(ROOT, 'server', 'package.json'), {}).version ?? '0.0.0'

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

export const POLL_INTERVAL_MIN_SEC = 60
export const POLL_INTERVAL_MAX_SEC = 3600

export const DEFAULT_SETTINGS: Settings = {
  port: 8768,
  pollIntervalSec: 300,
  changelogPrefetch: true,
  language: 'en',
}

export function clampPollInterval(v: number): number {
  return Math.min(POLL_INTERVAL_MAX_SEC, Math.max(POLL_INTERVAL_MIN_SEC, Math.round(v)))
}

// Whitelist-parse the settings file (never spread unknown keys into live settings)
// and migrate the pre-contract pollIntervalMin (minutes) to pollIntervalSec.
export function loadSettings(): Settings {
  const raw = readJson<Record<string, unknown>>(SETTINGS_FILE, {})
  const s: Settings = { ...DEFAULT_SETTINGS }
  if (
    typeof raw.port === 'number' &&
    Number.isInteger(raw.port) &&
    raw.port > 0 &&
    raw.port < 65536
  ) {
    s.port = raw.port
  }
  if (typeof raw.pollIntervalSec === 'number' && Number.isFinite(raw.pollIntervalSec)) {
    s.pollIntervalSec = clampPollInterval(raw.pollIntervalSec)
  } else if (typeof raw.pollIntervalMin === 'number' && Number.isFinite(raw.pollIntervalMin)) {
    s.pollIntervalSec = clampPollInterval(raw.pollIntervalMin * 60)
  }
  if (typeof raw.changelogPrefetch === 'boolean') s.changelogPrefetch = raw.changelogPrefetch
  if (raw.language === 'en' || raw.language === 'zh') s.language = raw.language
  if (typeof raw.steamRootOverride === 'string' && raw.steamRootOverride.trim()) {
    s.steamRootOverride = raw.steamRootOverride.trim()
  }
  // Mirrors the PATCH /api/settings validation (server/src/api.ts).
  if (typeof raw.steamWebApiKey === 'string' && /^[0-9A-F]{32}$/i.test(raw.steamWebApiKey.trim())) {
    s.steamWebApiKey = raw.steamWebApiKey.trim()
  }
  if ('pollIntervalMin' in raw) void writeJson(SETTINGS_FILE, s) // persist the migration
  return s
}

export function saveSettings(s: Settings): void {
  void writeJson(SETTINGS_FILE, s)
}
