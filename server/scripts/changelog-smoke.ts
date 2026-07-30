// Changelog cursor API smoke: exercises the stage-B cursor engine against ONE
// real mod id over the real network (throttled global queue, 4s spacing).
// Run: npx tsx scripts/changelog-smoke.ts [modId]
import {
  changelogQueueStats,
  getChangelogCursor,
  type ChangelogWireEntry,
} from '../src/changelog.js'
import { hub, initHub } from '../src/hub.js'

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
}

await initHub()

// Pick the target: CLI arg, else the ok-status record with the most subscribers
// (most likely to have a long, real changelog history).
const argId = process.argv[2]
let modId = argId && /^\d+$/.test(argId) ? argId : ''
if (!modId) {
  let best: { id: string; subs: number } | null = null
  for (const [id, rec] of hub.mods) {
    if (rec.remote?.fetchStatus !== 'ok' || !rec.remote.remoteTs) continue
    const subs = rec.remote.meta?.subscriptions ?? 0
    if (!best || subs > best.subs) best = { id, subs }
  }
  if (!best) {
    console.error('no ok-status mod records available')
    process.exit(1)
  }
  modId = best.id
}
const rec = hub.mods.get(modId)
const remoteTs = rec?.remote?.remoteTs
console.log(`target mod: ${modId} "${rec?.remote?.meta?.title ?? '?'}" remoteTs=${remoteTs}`)

// 1) first page through the cursor (may fetch p1 via the throttled queue)
const t0 = Date.now()
const page1 = await getChangelogCursor(modId, { limit: 5 }, remoteTs)
console.log(
  `page1: ${page1.entries.length} entries in ${Date.now() - t0}ms, hasMore=${page1.hasMore}, ` +
    `syncedThroughTs=${page1.syncedThroughTs}, status=${page1.status}`,
)
check('page1 status ok', page1.status === 'ok')
check('page1 has entries', page1.entries.length > 0)
const sortedDesc = page1.entries.every(
  (e, i) => i === 0 || e.ts < page1.entries[i - 1].ts ||
    (e.ts === page1.entries[i - 1].ts && e.ord > page1.entries[i - 1].ord),
)
check('page1 sorted ts desc / ord asc', sortedDesc)
check(
  'syncedThroughTs covers newest entry',
  (page1.syncedThroughTs ?? 0) >= (page1.entries[0]?.ts ?? 0),
)
check(
  'entries carry ts/ord/html/fetchedAt/date',
  page1.entries.every(
    e =>
      typeof e.ts === 'number' &&
      typeof e.ord === 'number' &&
      typeof e.html === 'string' &&
      typeof e.fetchedAt === 'number' &&
      typeof e.date === 'string',
  ),
)
check(
  'html contains no script/style/event handlers',
  page1.entries.every(e => !/<(script|style)|on\w+=/i.test(e.html)),
)
console.log('first entry:', page1.entries[0]?.ts, page1.entries[0]?.date)
console.log('first html head:', (page1.entries[0]?.html ?? '(empty)').slice(0, 160))

// 2) cursor pagination: strictly-older second page, no (ts, ord) duplicates
const cursorTs = page1.entries.at(-1)?.ts
if (cursorTs !== undefined && page1.hasMore) {
  const page2 = await getChangelogCursor(modId, { beforeTs: cursorTs, limit: 5 }, remoteTs)
  console.log(`page2 (before_ts=${cursorTs}): ${page2.entries.length} entries, hasMore=${page2.hasMore}`)
  check('page2 strictly older than cursor', page2.entries.every(e => e.ts < cursorTs))
  const key = (e: ChangelogWireEntry): string => `${e.ts}:${e.ord}`
  const all = new Set(page1.entries.map(key))
  check('no (ts, ord) duplicates across pages', page2.entries.every(e => !all.has(key(e))))
} else {
  console.log('skip page2 (single-page changelog)')
}

// 3) walk the cursor past the cached tail (p1 caches 10 entries; pulling 20
//    forces a deeper ?p=2 fetch through the queue -> syncOlder path)
{
  let cursor: number | undefined
  const seen = new Set<string>()
  let pulled = 0
  let pages = 0
  for (; pages < 5; pages++) {
    const p = await getChangelogCursor(modId, { beforeTs: cursor, limit: 5 }, remoteTs)
    if (p.entries.length === 0) break
    for (const e of p.entries) seen.add(`${e.ts}:${e.ord}`)
    pulled += p.entries.length
    cursor = p.entries.at(-1)?.ts
    if (!p.hasMore) break
  }
  console.log(`cursor walk: ${pulled} entries over ${pages + 1} requests`)
  check('cursor walk crosses the p1 boundary (>10 entries)', pulled > 10, `${pulled}`)
  check('cursor walk yields no duplicates', seen.size === pulled, `${seen.size}/${pulled}`)
}

// 4) second read of page1 is served from cache (no network wait)
const t1 = Date.now()
const again = await getChangelogCursor(modId, { limit: 5 }, remoteTs)
const cachedMs = Date.now() - t1
check('cached re-read is instant', cachedMs < 500, `${cachedMs}ms`)
check(
  'cached re-read identical head',
  again.entries[0]?.ts === page1.entries[0]?.ts && again.entries[0]?.ord === page1.entries[0]?.ord,
)

// 4) in-flight dedup: two concurrent cursor reads on a cold mod join one fetch
//    (bogus id -> HTTP-200 error page -> negative-cached 'unavailable')
const bogus = '999999999999'
const tb = Date.now()
const [b1, b2] = await Promise.all([
  getChangelogCursor(bogus, { limit: 5 }),
  getChangelogCursor(bogus, { limit: 5 }),
])
console.log(`bogus id concurrent: ${Date.now() - tb}ms, status=${b1.status}/${b2.status}`)
check('bogus id unavailable', b1.status === 'unavailable' && b2.status === 'unavailable')
const tn = Date.now()
const b3 = await getChangelogCursor(bogus, { limit: 5 })
const negMs = Date.now() - tn
check('negative cache short-circuits', b3.status === 'unavailable' && negMs < 200, `${negMs}ms`)

console.log('queue stats:', JSON.stringify(changelogQueueStats()))
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
