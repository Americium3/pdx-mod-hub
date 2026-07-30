import { createApp } from './api.js'
import {
  hub,
  initHub,
  onAcfChange,
  onLibrariesChanged,
  refreshSteamRunning,
  setWatcherRefreshHook,
  startPollLoop,
} from './hub.js'
import { pruneImageCache } from './images.js'
import { startWatchers } from './steam/watcher.js'

await initHub()
pruneImageCache()

const port = hub.settings.port
const app = createApp(port)

const server = app.listen(port, '127.0.0.1', () => {
  console.log(`PDX Mod Hub server on http://127.0.0.1:${port}`)
  console.log(`Steam root: ${hub.steamRoot ?? 'NOT FOUND'}`)
  console.log(
    `Libraries: ${hub.libraries.map(l => `${l.path}${l.reachable ? '' : ' (offline)'}`).join(' | ')}`,
  )
  const acfGames = hub.games.filter(g => g.hasWorkshopAcf).length
  console.log(`Workshop items on disk: ${[...hub.acfByApp.values()].reduce((s, m) => s + m.size, 0)} across ${acfGames} games`)
})

// Single-instance handling: probe the occupant's identity and exit with a clear message.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code !== 'EADDRINUSE') throw err
  void (async () => {
    let who = 'an unknown process'
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/ping`, {
        headers: { 'X-PMH': '1' },
        signal: AbortSignal.timeout(2_000),
      })
      const j = (await res.json()) as { app?: string; version?: string }
      if (j.app === 'pdx-mod-hub') who = `another PDX Mod Hub instance (v${j.version ?? '?'})`
    } catch {
      // occupant did not answer the ping
    }
    console.error(
      `Port ${port} is already in use by ${who}. ` +
        `Stop it or change "port" in data/settings.json, then restart.`,
    )
    process.exit(1)
  })()
})

const watchers = startWatchers({
  getLibraries: () => hub.libraries.filter(l => l.reachable).map(l => l.path),
  getSteamRoot: () => hub.steamRoot,
  onWorkshopChange: appId => void onAcfChange(appId),
  onLibrariesChanged: () => {
    void onLibrariesChanged().then(() => watchers.refresh())
  },
})
setWatcherRefreshHook(() => watchers.refresh())

startPollLoop(3_000)
setInterval(() => refreshSteamRunning(), 60_000).unref()
