import { createApp } from './api.js'
import { hub, initHub, onAcfChange, pollRemote } from './hub.js'
import { pruneImageCache } from './images.js'
import { startWatchers } from './steam/watcher.js'

initHub()
pruneImageCache()

const port = hub.settings.port
const app = createApp(port)

app.listen(port, '127.0.0.1', () => {
  console.log(`PDX Mod Hub server on http://127.0.0.1:${port}`)
  console.log(`Steam root: ${hub.steamRoot ?? 'NOT FOUND'}`)
  console.log(`Libraries: ${hub.libraries.join(' | ')}`)
  console.log(`Local mods: ${hub.local.size} across ${hub.games.filter(g => g.workshopAcf).length} games`)
})

startWatchers(hub.libraries, appId => onAcfChange(appId))

setTimeout(() => void pollRemote('startup'), 3_000)
setInterval(
  () => void pollRemote('interval'),
  Math.max(1, hub.settings.pollIntervalMin) * 60_000,
)
