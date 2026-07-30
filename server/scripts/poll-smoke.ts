// Dev smoke: one real poll (batch keyless GetPublishedFileDetails) + one real
// changelog fetch, against the stage-A record model.
import { getChangelogCursor } from '../src/changelog.js'
import { queryFeed } from '../src/events.js'
import { buildState, hub, initHub, pollRemote } from '../src/hub.js'

await initHub()
hub.settings.changelogPrefetch = false // keep the smoke run short (no prefetch queue)
await pollRemote('smoke')
console.log('lastPoll:', hub.lastPoll)

const ok = [...hub.mods.values()].filter(r => r.remote?.fetchStatus === 'ok').length
const nonOk = [...hub.mods.values()].filter(
  r => r.remote && r.remote.fetchStatus !== 'ok',
)
console.log('records:', hub.mods.size, 'remote ok:', ok)
console.log(
  'non-ok statuses:',
  nonOk.map(r => `${r.id}=${r.remote?.fetchStatus}`).slice(0, 10),
)

const state = buildState()
const counts: Record<string, number> = {}
for (const m of state.mods) counts[m.state] = (counts[m.state] ?? 0) + 1
console.log('state histogram:', counts)

const updates = state.mods.filter(
  m => m.state === 'update-unseen' || m.state === 'update-pending-launch',
)
console.log(
  'updates:',
  updates.length,
  updates.slice(0, 8).map(m => `${m.id}(${m.title})[${m.state}]`),
)

const feed = queryFeed({ limit: 5 })
console.log(
  'feed head:',
  feed.events.map(e => `#${e.seq} ${e.type} ${e.modId} "${e.title ?? '?'}"`),
  'seq:',
  feed.seq,
  'hasMore:',
  feed.hasMore,
)

const sampleId = updates[0]?.id ?? state.mods[0]?.id
if (sampleId) {
  const rec = hub.mods.get(sampleId)
  console.log('sample mod:', sampleId, rec?.remote?.meta?.title, 'remoteTs:', rec?.remote?.remoteTs)
  const cl = await getChangelogCursor(sampleId, { limit: 20 }, rec?.remote?.remoteTs)
  console.log('changelog entries:', cl.entries.length, 'hasMore:', cl.hasMore, 'status:', cl.status)
  console.log('first entry:', cl.entries[0]?.date, cl.entries[0]?.ts, 'ord:', cl.entries[0]?.ord)
  console.log('first entry html head:', (cl.entries[0]?.html ?? '').slice(0, 200))
}
