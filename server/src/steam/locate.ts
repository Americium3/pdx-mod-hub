import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { parseVdf, vdfChild } from '../vdf.js'
import type { LibraryInfo } from '../types.js'

// reg runs synchronously on the event loop, so it is capped: one that never
// returns would otherwise freeze every HTTP request, the poll timer and the
// watchers with it.
const REG_TIMEOUT_MS = 5_000

function regQueryRaw(hive: string, key: string, value: string): string | null {
  try {
    return execFileSync('reg', ['query', `${hive}\\${key}`, '/v', value], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: REG_TIMEOUT_MS,
    })
  } catch {
    return null // missing key/value, or timed out
  }
}

function regQuery(hive: string, key: string, value: string): string | null {
  const m = regQueryRaw(hive, key, value)?.match(/REG_SZ\s+(.+)/)
  return m ? m[1].trim() : null
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

/**
 * Steam writes its PID to HKCU\Software\Valve\Steam\ActiveProcess and zeroes
 * it on a clean exit; the liveness probe catches a PID left behind by a crash.
 * This used to shell out to `tasklist`, which takes 5-10s on the owner's
 * machine and blocked the event loop that long every minute.
 */
export function isSteamRunning(): boolean {
  const m = regQueryRaw('HKCU', 'Software\\Valve\\Steam\\ActiveProcess', 'pid')?.match(
    /REG_DWORD\s+0x([0-9a-f]+)/i,
  )
  const pid = m ? Number.parseInt(m[1], 16) : 0
  if (!pid) return false
  try {
    process.kill(pid, 0) // signal 0: existence check only
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM' // alive, just not ours to signal
  }
}
