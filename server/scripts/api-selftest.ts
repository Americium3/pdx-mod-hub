// Ephemeral self-test: boots the Express app on a scratch port, exercises the
// security middleware + new routes in-process, then exits. Not part of CI; run
// manually with: npx tsx scripts/api-selftest.ts
import http from 'node:http'
import { createApp } from '../src/api.js'
import { initHub } from '../src/hub.js'
import { flushStores } from '../src/store.js'

const PORT = 18768
await initHub()
const app = createApp(PORT)
const server = app.listen(PORT, '127.0.0.1')
await new Promise<void>(r => server.once('listening', () => r()))

const base = `http://127.0.0.1:${PORT}`
let failures = 0

async function check(
  name: string,
  expected: number,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const res = await fetch(`${base}${path}`, init)
  const ok = res.status === expected
  if (!ok) failures++
  let body: unknown
  try {
    body = await res.json()
  } catch {
    body = undefined
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${res.status} (want ${expected})`)
  return body
}

const H = { 'X-PMH': '1' }
const HJ = { 'X-PMH': '1', 'Content-Type': 'application/json' }

// security posture
await check('ping without X-PMH rejected', 403, '/api/ping')
// fetch() refuses to override Host, so use raw http for the rebinding check
const rebindStatus = await new Promise<number>((resolve, reject) => {
  const req = http.request(
    { host: '127.0.0.1', port: PORT, path: '/api/ping', headers: { Host: 'evil.test:18768', 'X-PMH': '1' } },
    res => {
      res.resume()
      resolve(res.statusCode ?? 0)
    },
  )
  req.on('error', reject)
  req.end()
})
if (rebindStatus !== 403) failures++
console.log(`${rebindStatus === 403 ? 'PASS' : 'FAIL'} bad Host rejected: ${rebindStatus} (want 403)`)
await check(
  'bad Origin on POST rejected',
  403,
  '/api/rescan',
  { method: 'POST', headers: { ...H, Origin: 'http://evil.test' } },
)
await check(
  'text/plain body never parsed (settings -> no fields applied)',
  200,
  '/api/settings',
  { method: 'POST', headers: H, body: 'pollIntervalSec=1' },
)
// core surface
const ping = (await check('ping', 200, '/api/ping', { headers: H })) as Record<string, unknown>
console.log('  ping payload:', JSON.stringify(ping))
const state = (await check('state', 200, '/api/state', { headers: H })) as {
  mods: Array<{ id: string }>
  seq: number
  lastPoll: unknown
}
console.log(`  state: ${state.mods.length} mods, seq=${state.seq}, lastPoll=${JSON.stringify(state.lastPoll)}`)
const modId = state.mods[0]?.id
if (modId) {
  const detail = (await check('mod detail', 200, `/api/mods/${modId}`, { headers: H })) as Record<
    string,
    unknown
  >
  console.log(
    '  detail fields:',
    ['title', 'state', 'fetchStatus', 'dependencies'].map(k => `${k}=${JSON.stringify(detail[k])}`).join(' '),
  )
}
await check('mod detail 404', 404, '/api/mods/1', { headers: H })
const feed = (await check('feed', 200, '/api/feed?limit=3', { headers: H })) as {
  events: Array<{ seq: number }>
  hasMore: boolean
}
console.log(`  feed: ${feed.events.length} events, hasMore=${feed.hasMore}`)
const cursor = feed.events.at(-1)?.seq
if (cursor !== undefined) {
  const page2 = (await check('feed before_seq', 200, `/api/feed?before_seq=${cursor}&limit=3`, {
    headers: H,
  })) as { events: Array<{ seq: number }> }
  const okCursor = page2.events.every(e => e.seq < cursor)
  if (!okCursor) failures++
  console.log(`  ${okCursor ? 'PASS' : 'FAIL'} cursor page strictly older`)
}
await check('feed bad cursor', 400, '/api/feed?before_seq=abc', { headers: H })
// stage-B surfaces (validation paths only — nothing here spawns the helper)
await check('changelog bad id', 400, '/api/mods/abc/changelog', { headers: H })
await check('changelog bad before_ts', 400, '/api/mods/123/changelog?before_ts=x', { headers: H })
await check('browse bad appId', 400, '/api/browse/nope', { method: 'POST', headers: HJ, body: '{}' })
await check(
  'browse bad sort',
  400,
  '/api/browse/394360',
  { method: 'POST', headers: HJ, body: JSON.stringify({ sort: 'newest' }) },
)
await check(
  'browse relevance without q',
  400,
  '/api/browse/394360',
  { method: 'POST', headers: HJ, body: JSON.stringify({ sort: 'relevance' }) },
)
await check(
  'browse q with non-relevance sort',
  400,
  '/api/browse/394360',
  { method: 'POST', headers: HJ, body: JSON.stringify({ sort: 'updated', q: 'x' }) },
)
await check(
  'browse page out of range',
  400,
  '/api/browse/394360',
  { method: 'POST', headers: HJ, body: JSON.stringify({ sort: 'updated', page: 99 }) },
)
await check(
  'unknown action name 404',
  404,
  '/api/actions/launch',
  { method: 'POST', headers: HJ, body: JSON.stringify({ appId: 1, modId: '1' }) },
)
await check(
  'action bad body 400',
  400,
  '/api/actions/subscribe',
  { method: 'POST', headers: HJ, body: JSON.stringify({ appId: 'x', modId: 'y' }) },
)
await check('unknown action id 404', 404, '/api/actions/no-such-id', { headers: H })
await check('sync bad appId 400', 400, '/api/sync/abc', { method: 'POST', headers: HJ, body: '{}' })
const cacheStats = (await check('imgcache stats', 200, '/api/imgcache', { headers: H })) as {
  files?: number
  bytes?: number
  maxBytes?: number
}
console.log('  imgcache:', JSON.stringify(cacheStats))
if (typeof cacheStats?.maxBytes !== 'number') failures++
await check('img bad url 400', 400, '/api/img?u=notaurl')
await check('img http rejected 403', 403, `/api/img?u=${encodeURIComponent('http://images.steamusercontent.com/x.jpg')}`)
await check('img disallowed host 403', 403, `/api/img?u=${encodeURIComponent('https://example.com/x.jpg')}`)
await check('img private host 403', 403, `/api/img?u=${encodeURIComponent('https://127.0.0.1/x.jpg')}`)
// settings validation
await check(
  'settings unknown key 422',
  422,
  '/api/settings',
  { method: 'PATCH', headers: HJ, body: JSON.stringify({ nope: 1 }) },
)
await check(
  'settings proto key 422',
  422,
  '/api/settings',
  { method: 'PATCH', headers: HJ, body: JSON.stringify({ ['__proto__']: {} }) },
)
await check(
  'settings bad type 422',
  422,
  '/api/settings',
  { method: 'PATCH', headers: HJ, body: JSON.stringify({ pollIntervalSec: 'x' }) },
)
const applied = (await check(
  'settings clamp applies',
  200,
  '/api/settings',
  { method: 'PATCH', headers: HJ, body: JSON.stringify({ pollIntervalSec: 5 }) },
)) as { settings?: { pollIntervalSec?: number } }
const clamped = applied.settings?.pollIntervalSec === 60
if (!clamped) failures++
console.log(`  ${clamped ? 'PASS' : 'FAIL'} pollIntervalSec clamped to 60`)
await fetch(`${base}/api/settings`, {
  method: 'PATCH',
  headers: HJ,
  body: JSON.stringify({ pollIntervalSec: 300 }),
}) // restore

server.close()
await flushStores() // let queued settings writes land before exiting
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
