import fs from 'node:fs'
import path from 'node:path'

const DEBOUNCE_MS = 2_500

// Steam rewrites appworkshop ACFs repeatedly while downloading; debounce per appid.
export function startWatchers(libraries: string[], onChange: (appId: number) => void): void {
  const timers = new Map<number, NodeJS.Timeout>()
  for (const lib of libraries) {
    const dir = path.join(lib, 'steamapps', 'workshop')
    if (!fs.existsSync(dir)) continue
    try {
      fs.watch(dir, (_event, filename) => {
        const m = filename?.match(/^appworkshop_(\d+)\.acf$/)
        if (!m) return
        const appId = Number(m[1])
        clearTimeout(timers.get(appId))
        timers.set(
          appId,
          setTimeout(() => {
            timers.delete(appId)
            onChange(appId)
          }, DEBOUNCE_MS),
        )
      })
    } catch {
      // watcher is an enhancement; polling still covers state refresh
    }
  }
}
