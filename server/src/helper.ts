import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import readline from 'node:readline'
import { HELPER_SCRIPT } from './config.js'
import { hub, saveSubs } from './hub.js'
import { broadcastPoke } from './sse.js'
import type { SubsCache } from './types.js'

// Helper process management (must-fix 3, 8, 9, 10).
//
// ONE helper child exists at any time across all appids. Persistent SESSIONS
// (node steam_helper.js session <appId>) speak newline-JSON over stdio and are
// kept alive 60s idle / 10min hard cap, so paginating Browse costs one in-game
// flash instead of one per page. Every session start piggybacks
// getSubscribedItems (the helper's hello), freshening account.asOf for that
// app at zero extra cost. All ops — session or one-shot — serialize on one
// global chain. Hygiene: shell:false spawns, /^[0-9]+$/ arg validation, hard
// timeouts, PID tracking with Windows tree-kill on server exit.

const SESSION_IDLE_MS = 60_000
const SESSION_HARD_CAP_MS = 10 * 60_000
const HELLO_TIMEOUT_MS = 30_000
const DEFAULT_REQUEST_TIMEOUT_MS = 90_000
const EXIT_GRACE_MS = 1_500

const NUMERIC = /^[0-9]+$/
const CSV_NUMERIC = /^[0-9]+(,[0-9]+)*$/

export interface HelperResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

export interface HelperSyncItem {
  id: string
  state: number
  folder: string | null
  sizeOnDisk: number | null
  timestamp: number | null
}

/** Steamworks init failed — in practice: Steam is not running / app not owned. */
export class HelperInitError extends Error {}

const now = (): number => Math.floor(Date.now() / 1000)

// ---------------------------------------------------------------- PID hygiene

const livePids = new Set<number>()

function killTree(pid: number): void {
  try {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
  } catch {
    // best-effort
  }
}

let exitHooksInstalled = false
function installExitHooks(): void {
  if (exitHooksInstalled) return
  exitHooksInstalled = true
  process.on('exit', () => {
    for (const pid of livePids) killTree(pid)
  })
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK'] as const) {
    process.on(sig, () => {
      process.exit(0) // triggers the exit hook above
    })
  }
}

// ---------------------------------------------------------------- account piggyback

/** Fresh getSubscribedItems snapshot from a helper launch -> account facts. */
function applyAccountSnapshot(appId: number, items: HelperSyncItem[]): void {
  const cache: SubsCache = {
    appId,
    syncedAt: now(),
    ids: items.map(i => String(i.id)),
    states: Object.fromEntries(items.map(i => [String(i.id), i.state])),
  }
  saveSubs(cache)
  broadcastPoke('state')
}

function parseSyncItems(v: unknown): HelperSyncItem[] | null {
  if (!Array.isArray(v)) return null
  const out: HelperSyncItem[] = []
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') continue
    const it = raw as Record<string, unknown>
    const id = String(it.id ?? '')
    if (!NUMERIC.test(id)) continue
    out.push({
      id,
      state: typeof it.state === 'number' ? it.state : 0,
      folder: typeof it.folder === 'string' ? it.folder : null,
      sizeOnDisk: typeof it.sizeOnDisk === 'number' ? it.sizeOnDisk : null,
      timestamp: typeof it.timestamp === 'number' ? it.timestamp : null,
    })
  }
  return out
}

// ---------------------------------------------------------------- session

interface PendingRequest {
  resolve: (r: HelperResult) => void
  timer: NodeJS.Timeout
  onProgress?: (stage: string) => void
}

class HelperSession {
  readonly appId: number
  readonly startedAt = Date.now()
  closed = false
  private closing = false
  helloItems: HelperSyncItem[] | null = null

  private child: ChildProcess
  private pending = new Map<number, PendingRequest>()
  private nextReqId = 1
  private helloResolve: (() => void) | null = null
  private helloReject: ((e: Error) => void) | null = null
  private stderrTail = ''
  readonly helloPromise: Promise<void>
  private hardTimer: NodeJS.Timeout

  constructor(appId: number) {
    this.appId = appId
    installExitHooks()
    this.child = spawn(process.execPath, [HELPER_SCRIPT, 'session', String(appId)], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    if (this.child.pid) livePids.add(this.child.pid)

    this.helloPromise = new Promise<void>((resolve, reject) => {
      this.helloResolve = resolve
      this.helloReject = reject
      setTimeout(() => reject(new HelperInitError('helper hello timeout')), HELLO_TIMEOUT_MS).unref()
    })
    this.helloPromise.catch(() => undefined) // observed by acquireSession

    // A write to a dying child's stdin emits an ASYNC 'error' on the stream; with
    // no listener Node escalates it to an unhandled process-level 'error' and
    // crashes the single-instance server. Swallow broken-pipe/EPIPE here (the
    // request/close paths already resolve the pending op with ok:false).
    this.child.stdin?.on('error', () => undefined)
    this.child.stdout?.on('error', () => undefined)
    const rl = readline.createInterface({ input: this.child.stdout as NodeJS.ReadableStream })
    rl.on('line', line => this.onLine(line))
    this.child.stderr?.on('error', () => undefined)
    this.child.stderr?.on('data', d => {
      this.stderrTail = (this.stderrTail + String(d)).slice(-400)
    })
    this.child.on('error', e => this.onClosed(String(e)))
    this.child.on('close', () => this.onClosed('helper exited'))

    this.hardTimer = setTimeout(() => {
      // 10min hard cap regardless of activity
      void this.close()
    }, SESSION_HARD_CAP_MS)
    this.hardTimer.unref()
  }

  get expired(): boolean {
    // `closing` (set at the top of close()) makes acquireSession treat a session
    // whose exit is in progress as expired, so a queued op awaits the close and
    // spawns a fresh child instead of writing to the dying one.
    return this.closed || this.closing || Date.now() - this.startedAt > SESSION_HARD_CAP_MS - 5_000
  }

  private onLine(line: string): void {
    const text = line.trim()
    if (!text.startsWith('{')) return
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(text) as Record<string, unknown>
    } catch {
      return // native/stray output on stdout
    }
    if (msg.type === 'hello') {
      const items = parseSyncItems(msg.items) ?? []
      this.helloItems = items
      applyAccountSnapshot(this.appId, items) // account piggyback (must-fix 10)
      this.helloResolve?.()
      return
    }
    const reqId = typeof msg.reqId === 'number' ? msg.reqId : null
    if (reqId !== null) {
      const pend = this.pending.get(reqId)
      if (!pend) return
      if (msg.type === 'progress') {
        if (typeof msg.stage === 'string') pend.onProgress?.(msg.stage)
        return
      }
      this.pending.delete(reqId)
      clearTimeout(pend.timer)
      pend.resolve(msg as unknown as HelperResult)
      return
    }
    // pre-hello failure line: {ok:false, error:'init failed: ...'}
    if (msg.ok === false && this.helloItems === null) {
      this.helloReject?.(new HelperInitError(String(msg.error ?? 'helper init failed')))
    }
  }

  request(
    payload: Record<string, unknown>,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    onProgress?: (stage: string) => void,
  ): Promise<HelperResult> {
    if (this.closed) {
      return Promise.resolve({ ok: false, error: 'helper session closed' })
    }
    const reqId = this.nextReqId++
    return new Promise<HelperResult>(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(reqId)
        resolve({ ok: false, error: `helper request timeout after ${timeoutMs}ms` })
        void this.close() // a wedged op makes the child suspect
      }, timeoutMs)
      this.pending.set(reqId, { resolve, timer, onProgress })
      try {
        const ok = this.child.stdin?.write(JSON.stringify({ reqId, ...payload }) + '\n')
        if (!ok && this.child.stdin === null) {
          clearTimeout(timer)
          this.pending.delete(reqId)
          resolve({ ok: false, error: 'helper stdin unavailable' })
        }
      } catch {
        // write-after-destroy on a dying child: resolve rather than throw
        clearTimeout(timer)
        this.pending.delete(reqId)
        resolve({ ok: false, error: 'helper stdin write failed' })
      }
    })
  }

  private onClosed(reason: string): void {
    if (this.closed) return
    this.closed = true
    clearTimeout(this.hardTimer)
    if (this.child.pid) livePids.delete(this.child.pid)
    this.helloReject?.(new HelperInitError(`${reason}${this.stderrTail ? `: ${this.stderrTail}` : ''}`))
    for (const [reqId, pend] of this.pending) {
      this.pending.delete(reqId)
      clearTimeout(pend.timer)
      pend.resolve({ ok: false, error: reason })
    }
    if (current === this) {
      current = null
      hub.helperDepth = Math.max(0, hub.helperDepth - 1)
      broadcastPoke('state')
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return
    }
    this.closing = true // mid-close: acquireSession must not reuse this session
    try {
      this.child.stdin?.write(JSON.stringify({ reqId: 0, op: 'exit' }) + '\n')
    } catch {
      // already gone
    }
    const pid = this.child.pid
    await new Promise<void>(resolve => {
      const force = setTimeout(() => {
        if (pid) killTree(pid)
        resolve()
      }, EXIT_GRACE_MS)
      this.child.once('close', () => {
        clearTimeout(force)
        resolve()
      })
    })
    this.onClosed('helper session closed')
  }
}

// ---------------------------------------------------------------- global serialization

let current: HelperSession | null = null
let idleTimer: NodeJS.Timeout | null = null
let chain: Promise<unknown> = Promise.resolve()

function armIdleTimer(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (current) void current.close()
  }, SESSION_IDLE_MS)
  idleTimer.unref()
}

async function acquireSession(appId: number): Promise<HelperSession> {
  if (current && current.appId === appId && !current.expired) return current
  if (current) await current.close()
  const session = new HelperSession(appId)
  current = session
  hub.helperDepth += 1
  broadcastPoke('state')
  try {
    await session.helloPromise
  } catch (e) {
    await session.close()
    throw e instanceof HelperInitError ? e : new HelperInitError(String(e))
  }
  return session
}

/**
 * Run an operation against the (single, global) helper session for an app.
 * Ops serialize on one chain — one helper child at a time across all appids.
 * Throws HelperInitError when Steamworks cannot init (Steam not running).
 */
export function runWithSession<T>(
  appId: number,
  fn: (session: HelperSession) => Promise<T>,
): Promise<T> {
  if (!Number.isInteger(appId) || appId <= 0) {
    return Promise.reject(new Error('bad appId'))
  }
  const run = async (): Promise<T> => {
    if (idleTimer) clearTimeout(idleTimer)
    const session = await acquireSession(appId)
    try {
      return await fn(session)
    } finally {
      armIdleTimer()
    }
  }
  const next = chain.then(run, run)
  chain = next.catch(() => undefined)
  return next
}

/**
 * Sync the account subscription set for an app through the session (the
 * op re-runs getSubscribedItems; results persist as the app's account facts).
 */
export async function syncViaSession(appId: number): Promise<number> {
  const result = await runWithSession(appId, s => s.request({ op: 'sync' }))
  if (!result.ok) throw new Error(result.error ?? 'helper sync failed')
  const items = parseSyncItems(result.items) ?? []
  applyAccountSnapshot(appId, items)
  return items.length
}

/** Close any live session (settings changes / tests). */
export function closeHelperSession(): Promise<void> {
  const run = async (): Promise<void> => {
    if (idleTimer) clearTimeout(idleTimer)
    if (current) await current.close()
  }
  const next = chain.then(run, run)
  chain = next.catch(() => undefined)
  return next as Promise<void>
}

// ---------------------------------------------------------------- one-shot mode

const ONE_SHOT_CMDS = new Set(['sync', 'probe', 'subscribe', 'unsubscribe', 'download', 'force'])

/**
 * Legacy one-shot invocation (still used for `probe`). Serialized on the same
 * global chain; any live session is closed first so only one child exists.
 * Args are strictly validated: numeric, or numeric CSV for probe.
 */
export function runHelper(
  cmd: string,
  appId: number,
  args: string[] = [],
  timeoutMs = 90_000,
): Promise<HelperResult> {
  if (!ONE_SHOT_CMDS.has(cmd)) {
    return Promise.resolve({ ok: false, error: `unknown helper cmd: ${cmd}` })
  }
  if (!Number.isInteger(appId) || appId <= 0) {
    return Promise.resolve({ ok: false, error: 'bad appId' })
  }
  const argPattern = cmd === 'probe' ? CSV_NUMERIC : NUMERIC
  for (const a of args) {
    if (!argPattern.test(a)) return Promise.resolve({ ok: false, error: `bad helper arg: ${a.slice(0, 40)}` })
  }
  const run = async (): Promise<HelperResult> => {
    if (idleTimer) clearTimeout(idleTimer)
    if (current) await current.close()
    installExitHooks()
    const result = await new Promise<HelperResult>(resolve => {
      const child = spawn(process.execPath, [HELPER_SCRIPT, cmd, String(appId), ...args], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      if (child.pid) livePids.add(child.pid)
      let out = ''
      let err = ''
      let done = false
      const finish = (result: HelperResult): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (child.pid) livePids.delete(child.pid)
        resolve(result)
      }
      const timer = setTimeout(() => {
        if (child.pid) killTree(child.pid)
        finish({ ok: false, error: `helper timeout after ${timeoutMs}ms` })
      }, timeoutMs)
      child.stdout?.on('data', d => (out += d))
      child.stderr?.on('data', d => (err += d))
      child.on('error', e => finish({ ok: false, error: String(e) }))
      child.on('close', () => {
        const lines = out.trim().split('\n')
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            finish(JSON.parse(lines[i]) as HelperResult)
            return
          } catch {
            // not JSON, keep scanning up
          }
        }
        finish({ ok: false, error: `helper produced no result${err ? `: ${err.slice(0, 400)}` : ''}` })
      })
    })
    // account piggyback from one-shot launches (must-fix 10)
    if (result.ok) {
      const piggyback = parseSyncItems(result.piggyback)
      if (piggyback) applyAccountSnapshot(appId, piggyback)
    }
    return result
  }
  const next = chain.then(run, run)
  chain = next.catch(() => undefined)
  return next
}

export type { HelperSession }
