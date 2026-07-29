// Dev smoke: one real poll (batch GetPublishedFileDetails) + one real changelog fetch.
import { getChangelog } from '../src/changelog.js'
import { hub, initHub, pollRemote } from '../src/hub.js'

initHub()
await pollRemote('smoke')
console.log('lastPoll:', hub.lastPoll, 'error:', hub.lastPollError ?? 'none')
console.log('remote entries:', hub.remote.size)

const updates = [...hub.local.values()].filter(m => {
  const rm = hub.remote.get(m.id)
  return rm?.timeUpdated !== undefined && rm.timeUpdated > m.timeUpdated
})
console.log(
  'update-available:',
  updates.length,
  updates.slice(0, 8).map(m => `${m.id}(${hub.remote.get(m.id)?.title ?? '?'})`),
)

const sampleId = updates[0]?.id ?? [...hub.local.keys()][0]
const sample = hub.remote.get(sampleId)
console.log('sample mod:', sampleId, sample?.title, 'remote ts:', sample?.timeUpdated)
const cl = await getChangelog(sampleId, 1, sample?.timeUpdated)
console.log('changelog entries:', cl.entries.length, 'hasMore:', cl.hasMore)
console.log('first entry:', cl.entries[0]?.date, cl.entries[0]?.ts)
console.log('first entry html head:', (cl.entries[0]?.html ?? '').slice(0, 200))
