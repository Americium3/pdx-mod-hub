// One REAL helper session against HOI4 (394360): validates the stage-B session
// protocol end-to-end — hello piggyback (account set refresh at zero extra
// flashes), a sync op, session reuse without a second launch, and clean
// shutdown. Costs one brief in-game flash; read-only (no subscribe/download).
// Run: npx tsx scripts/helper-session-smoke.ts
import { closeHelperSession, runWithSession, syncViaSession } from '../src/helper.js'
import { hub, initHub } from '../src/hub.js'

let failures = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`)
}

await initHub()
const appId = 394360
console.log('steamRunning:', hub.steamRunning)
const before = hub.subs.get(appId)?.syncedAt ?? 0
console.log(`subs before: syncedAt=${before} ids=${hub.subs.get(appId)?.ids.length ?? 0}`)

const t0 = Date.now()
const count = await syncViaSession(appId)
console.log(`syncViaSession: ${count} subscriptions in ${Date.now() - t0}ms`)
check('sync returned subscriptions', count > 0, String(count))

const after = hub.subs.get(appId)
console.log(`subs after: syncedAt=${after?.syncedAt} ids=${after?.ids.length}`)
check('account asOf freshened by piggyback', (after?.syncedAt ?? 0) > before)
check('helperDepth active during/after ops tracked', hub.helperDepth === 1, String(hub.helperDepth))

// second op reuses the LIVE session — no new helper launch, no extra flash
const t1 = Date.now()
const pong = await runWithSession(appId, s => s.request({ op: 'ping' }, 10_000))
const reuseMs = Date.now() - t1
check('session reuse (ping) ok', pong.ok === true)
check('session reuse is instant (no respawn)', reuseMs < 2_000, `${reuseMs}ms`)

await closeHelperSession()
check('helperDepth back to 0 after close', hub.helperDepth === 0, String(hub.helperDepth))

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
