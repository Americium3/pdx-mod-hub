import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseVdf, vdfChild } from '../vdf.js'
import type { LibraryInfo } from '../types.js'

function regQuery(hive: string, key: string, value: string): string | null {
  try {
    const out = execFileSync('reg', ['query', `${hive}\\${key}`, '/v', value], {
      encoding: 'utf8',
      windowsHide: true,
    })
    const m = out.match(/REG_SZ\s+(.+)/)
    return m ? m[1].trim() : null
  } catch {
    return null
  }
}

export function findSteamRoot(override?: string): string | null {
  if (override) {
    return fs.existsSync(override) ? path.resolve(override) : null
  }
  const cand =
    regQuery('HKCU', 'Software\\Valve\\Steam', 'SteamPath') ??
    regQuery('HKLM', 'SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath')
  if (cand) {
    const p = path.resolve(cand)
    if (fs.existsSync(p)) return p
  }
  const fallback = 'C:\\Program Files (x86)\\Steam'
  return fs.existsSync(fallback) ? fallback : null
}

// Every library listed in libraryfolders.vdf is returned, including currently
// unreachable ones (sleeping/unplugged drives) — the hub uses the reachable flag
// to mark games libraryOffline instead of producing false mass-removal diffs.
export function findLibraries(steamRoot: string): LibraryInfo[] {
  const out = new Map<string, boolean>()
  for (const rel of ['config/libraryfolders.vdf', 'steamapps/libraryfolders.vdf']) {
    const file = path.join(steamRoot, rel)
    if (!fs.existsSync(file)) continue
    let root
    try {
      root = parseVdf(fs.readFileSync(file, 'utf8'))
    } catch {
      continue
    }
    const lf = vdfChild(root, 'libraryfolders', 'LibraryFolders')
    if (!lf) continue
    for (const [k, v] of Object.entries(lf)) {
      if (!/^\d+$/.test(k)) continue
      const p = typeof v === 'string' ? v : typeof v.path === 'string' ? v.path : undefined
      if (!p) continue
      const full = path.resolve(p)
      out.set(full, out.get(full) || fs.existsSync(full))
    }
  }
  if (out.size === 0) out.set(path.resolve(steamRoot), true)
  return [...out].map(([p, reachable]) => ({ path: p, reachable }))
}

export function isSteamRunning(): boolean {
  try {
    const out = execFileSync('tasklist', ['/FI', 'IMAGENAME eq steam.exe', '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    return out.toLowerCase().includes('steam.exe')
  } catch {
    return false
  }
}
