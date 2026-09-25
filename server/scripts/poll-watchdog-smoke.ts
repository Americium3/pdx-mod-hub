// Dev smoke for the poll deadlines (takes ~3.5 minutes). Replays the
// 2026-09-24 stall: a GetPublishedFileDetails fetch that never settles.
//   1. fetch hangs, timers intact -> the 8s per-request deadline fails the poll.
//   2. fetch hangs AND its 8s timer never fires -> the 3-minute poll deadline
//      fails the poll and releases `polling`.
//   3. the abandoned run is then let through -> it must apply nothing.
// Deliberately skips initHub() and never lets a poll succeed, so nothing under
// data/ is written: a partial persistMods() would clobber the real mods.json,
// and a 'downloaded' event from the ACF diff would overwrite events.json. Each
// poll therefore re-seeds the ACF snapshot silently (acfSeeded = false).
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { hub, pollRemote } from '../src/hub.js'
import { writeJson } from '../src/store.js'

// Record every store write from this process. (File mtimes are no use: a live
// Ground Station keeps writing data/ on its own polls while this runs.)
const writes: string[] = []
const realRename = fsp.rename
fsp.rename = ((from: string, to: string) => {
  writes.push(String(to))
  return realRename(from, to)
}) as typeof fsp.rename
const poll = (reason: string): Promise<void> => {
  hub.acfSeeded = false
  return pollRemote(reason)
}

let failures = 0
function check(label: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
  if (!ok) failures += 1
}

// A fetch that never settles and ignores its abort signal, until released.
const realFetch = globalThis.fetch
const parked: Array<() => void> = []
let released = false
const fakeBody = JSON.stringify({
  response: {
    publishedfiledetails: [{ publishedfileid: '1', result: 1, title: 'zombie', time_updated: 1 }],
  },
})
globalThis.fetch = (() =>
  new Promise<Response>(resolve => {
    const go = (): void => resolve(new Response(fakeBody, { status: 200 }))
    if (released) go()
    else parked.push(go)
  })) as typeof fetch

// ---- 1. per-request deadline
let t0 = Date.now()
await poll('smoke-request-deadline')
check('hung fetch fails the poll within ~10s', Date.now() - t0 < 20_000, { ms: Date.now() - t0 })
check('lastPoll is failed with a timeout', hub.lastPoll.status === 'failed' && /timed out/.test(hub.lastPoll.error ?? ''), hub.lastPoll)
check('polling released', hub.polling === false)

// ---- 2. poll deadline: swallow the 8s request timers so nothing but the
// watchdog can end the poll (the production failure mode).
const realSetTimeout = globalThis.setTimeout
globalThis.setTimeout = ((fn: (...a: unknown[]) => void, ms?: number, ...rest: unknown[]) =>
  ms === 8_000 ? realSetTimeout(() => undefined, 2 ** 31 - 1) : realSetTimeout(fn, ms, ...rest)) as typeof setTimeout
t0 = Date.now()
console.log('waiting for the 180s poll deadline...')
await poll('smoke-poll-deadline')
const waited = Date.now() - t0
globalThis.setTimeout = realSetTimeout
check('watchdog ends the poll at ~180s', waited >= 179_000 && waited < 200_000, { ms: waited })
check('lastPoll is failed with the deadline message', /did not finish within 180s/.test(hub.lastPoll.error ?? ''), hub.lastPoll)
check('polling released', hub.polling === false)
check('a new poll can start', await (async () => {
  const p = poll('smoke-next')
  const started = hub.polling
  await p
  return started
})())

// ---- 3. let the abandoned runs finish; they must not touch state or disk
const lastPollBefore = JSON.stringify(hub.lastPoll)
released = true
for (const go of parked.splice(0)) go()
await new Promise(r => realSetTimeout(r, 2_000))
check('abandoned run left lastPoll alone', JSON.stringify(hub.lastPoll) === lastPollBefore, hub.lastPoll)
check('abandoned run did not record the fake mod', hub.mods.get('1')?.remote?.meta?.title !== 'zombie')
check('this process wrote nothing', writes.length === 0, writes)
// Control: the spy does see a real store write.
const probe = path.join(os.tmpdir(), `pmh-watchdog-smoke-${process.pid}.json`)
await writeJson(probe, { ok: true })
check('write spy is live (control)', writes.includes(probe), writes)
await fsp.rm(probe, { force: true })
await fsp.rm(`${probe}.bak`, { force: true })

globalThis.fetch = realFetch
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
