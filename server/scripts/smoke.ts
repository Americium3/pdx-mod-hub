// Dev smoke: scan the real local Steam state and print a summary. No network,
// no writes outside data/. Regression harness for the stage-A data model.
import { buildState, hub, initHub } from '../src/hub.js'

await initHub()
const state = buildState()
console.log('steamRoot :', hub.steamRoot)
console.log(
  'libraries :',
  hub.libraries.map(l => `${l.path}${l.reachable ? '' : ' (OFFLINE)'}`).join(' | '),
)
console.log('steam up  :', hub.steamRunning)
for (const g of state.games) {
  if (g.installed || g.hasWorkshopAcf) {
    console.log(
      `  ${g.short.padEnd(5)} ${String(g.appId).padEnd(8)} installed=${g.installed} acf=${g.hasWorkshopAcf ? 'yes' : 'no'} mods=${g.modCount} pending=${g.updatesPending}${g.libraryOffline ? ' OFFLINE' : ''}${g.warnings.length > 0 ? ` warnings=${JSON.stringify(g.warnings)}` : ''}`,
    )
  }
}
const counts: Record<string, number> = {}
for (const m of state.mods) counts[m.state] = (counts[m.state] ?? 0) + 1
console.log('records         :', hub.mods.size)
console.log('mod summaries   :', state.mods.length)
console.log('state histogram :', counts)
console.log('seq             :', state.seq)
console.log('lastPoll        :', state.lastPoll)
const withRange = state.mods.filter(m => m.branchRange)
console.log('branchRange mods:', withRange.length)
const sample = withRange[0] ?? state.mods[0]
console.log('sample summary  :', JSON.stringify(sample))
