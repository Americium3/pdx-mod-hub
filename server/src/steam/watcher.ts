import fs from 'node:fs'
import path from 'node:path'

// Directory-level watcher (must-fix 14): watch each library's steamapps/workshop
// DIRECTORY (never the ACF file — Steam replaces ACFs by rename, which kills file
// watchers on Windows), debounce 2s trailing per appid, plus a 60s mtime-stat
// backstop that also catches ACF creation/deletion and newly appearing workshop
// dirs. libraryfolders.vdf is watched too so libraries re-resolve on change.
// No-op ACF rewrites are discarded downstream by the hub's per-item snapshot diff.

const DEBOUNCE_MS = 2_000
const BACKSTOP_MS = 60_000
const ACF_RE = /^appworkshop_(\d+)\.acf$/

export interface WatcherOpts {
  getLibraries: () => string[] // reachable library roots
  getSteamRoot: () => string | null
  onWorkshopChange: (appId: number) => void
  onLibrariesChanged: () => void
}

export interface WatcherHandle {
  refresh: () => void
  stop: () => void
}

export function startWatchers(opts: WatcherOpts): WatcherHandle {
  const watchers: fs.FSWatcher[] = []
  const appTimers = new Map<number, NodeJS.Timeout>()
  const acfMtimes = new Map<string, number>() // full ACF path -> mtimeMs
  let workshopDirs: string[] = []
  let libTimer: NodeJS.Timeout | null = null
  let stopped = false

  const fireApp = (appId: number): void => {
    if (stopped) return
    clearTimeout(appTimers.get(appId))
    appTimers.set(
      appId,
      setTimeout(() => {
        appTimers.delete(appId)
        opts.onWorkshopChange(appId)
      }, DEBOUNCE_MS),
    )
  }

  const fireLibs = (): void => {
    if (stopped) return
    if (libTimer) clearTimeout(libTimer)
    libTimer = setTimeout(() => {
      libTimer = null
      opts.onLibrariesChanged()
    }, DEBOUNCE_MS)
  }

  const tryWatch = (dir: string, listener: (event: string, filename: string | null) => void): void => {
    try {
      const w = fs.watch(dir, listener)
      w.on('error', () => {
        // drive vanished mid-watch; the backstop keeps polling and refresh re-arms
        try {
          w.close()
        } catch {
          // already closed
        }
      })
      watchers.push(w)
    } catch {
      // watcher is an enhancement; the 60s backstop still covers this dir
    }
  }

  const seedMtimes = (): void => {
    acfMtimes.clear()
    for (const dir of workshopDirs) {
      let names: string[]
      try {
        names = fs.readdirSync(dir)
      } catch {
        continue
      }
      for (const name of names) {
        if (!ACF_RE.test(name)) continue
        const full = path.join(dir, name)
        try {
          acfMtimes.set(full, fs.statSync(full).mtimeMs)
        } catch {
          // raced away
        }
      }
    }
  }

  const refresh = (): void => {
    if (stopped) return
    for (const w of watchers.splice(0)) {
      try {
        w.close()
      } catch {
        // already closed
      }
    }
    workshopDirs = []
    for (const lib of opts.getLibraries()) {
      const steamapps = path.join(lib, 'steamapps')
      const workshop = path.join(steamapps, 'workshop')
      const hasWorkshop = fs.existsSync(workshop)
      if (hasWorkshop) {
        workshopDirs.push(workshop)
        tryWatch(workshop, (_event, filename) => {
          const m = filename ? ACF_RE.exec(filename) : null
          if (m) fireApp(Number(m[1]))
        })
      }
      if (fs.existsSync(steamapps)) {
        tryWatch(steamapps, (_event, filename) => {
          if (filename === 'libraryfolders.vdf') fireLibs()
          // a zero-workshop library got its first workshop item: start watching it
          else if (filename === 'workshop' && !hasWorkshop) refresh()
        })
      }
    }
    const root = opts.getSteamRoot()
    if (root) {
      const cfg = path.join(root, 'config')
      if (fs.existsSync(cfg)) {
        tryWatch(cfg, (_event, filename) => {
          if (filename === 'libraryfolders.vdf') fireLibs()
        })
      }
    }
    seedMtimes()
  }

  // 60s backstop: stat every known ACF; fire on mtime change, creation, deletion.
  const backstop = (): void => {
    if (stopped) return
    let needRefresh = false
    for (const lib of opts.getLibraries()) {
      const workshop = path.join(lib, 'steamapps', 'workshop')
      if (!workshopDirs.includes(workshop) && fs.existsSync(workshop)) needRefresh = true
    }
    for (const dir of workshopDirs) {
      let names: string[]
      try {
        names = fs.readdirSync(dir)
      } catch {
        continue // unreachable drive: keep old mtimes, never fire false deletions
      }
      const seen = new Set<string>()
      for (const name of names) {
        const m = ACF_RE.exec(name)
        if (!m) continue
        const full = path.join(dir, name)
        seen.add(full)
        let mtime: number
        try {
          mtime = fs.statSync(full).mtimeMs
        } catch {
          continue
        }
        if (acfMtimes.get(full) !== mtime) {
          acfMtimes.set(full, mtime)
          fireApp(Number(m[1]))
        }
      }
      for (const full of [...acfMtimes.keys()]) {
        if (!full.startsWith(dir + path.sep) || seen.has(full)) continue
        acfMtimes.delete(full) // ACF deleted while the dir stayed readable
        const m = ACF_RE.exec(path.basename(full))
        if (m) fireApp(Number(m[1]))
      }
    }
    if (needRefresh) refresh()
  }

  refresh()
  const backstopTimer = setInterval(backstop, BACKSTOP_MS)
  backstopTimer.unref()

  return {
    refresh,
    stop(): void {
      stopped = true
      clearInterval(backstopTimer)
      for (const w of watchers.splice(0)) {
        try {
          w.close()
        } catch {
          // already closed
        }
      }
      for (const t of appTimers.values()) clearTimeout(t)
      appTimers.clear()
      if (libTimer) clearTimeout(libTimer)
    },
  }
}
