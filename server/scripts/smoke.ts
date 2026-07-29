// Dev smoke: scan the real local Steam state and print a summary. No network, no writes
// outside data/.
import { buildState, hub, initHub } from '../src/hub.js'

initHub()
const state = buildState() as { games: Array<Record<string, unknown>>; mods: unknown[] }
console.log('steamRoot :', hub.steamRoot)
console.log('libraries :', hub.libraries.join(' | '))
console.log('steam up  :', hub.steamRunning)
for (const g of hub.games) {
  if (g.installed || g.workshopAcf) {
    console.log(
      `  ${String(g.short).padEnd(5)} ${String(g.appId).padEnd(8)} installed=${g.installed} acf=${g.workshopAcf ? 'yes' : 'no'} mods=${g.modCount}`,
    )
  }
}
console.log('total local mods:', hub.local.size)
console.log('mod views       :', state.mods.length)
