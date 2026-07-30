import crypto from 'node:crypto'
import {
  HelperInitError,
  runWithSession,
  syncViaSession,
  type HelperResult,
} from './helper.js'
import {
  addPending,
  addToSubs,
  ensureRecord,
  hub,
  metaFrom,
  persistMods,
  pollRemote,
  removeFromSubs,
  setAcfAdvanceHook,
} from './hub.js'
import { isSteamRunning } from './steam/locate.js'
import { broadcastPoke } from './sse.js'
import { fetchPublishedFileDetails } from './webapi.js'

// Actions as async jobs (must-fix 3, 9, 13, 18): every action POST returns
// 202 {actionId}; progress is pushed over SSE as pokes
// {type:'action', actionId, stage, detail, queuePosition} and GET
// /api/actions/:id serves the job record for reconnect catch-up. ONE global
// job queue; the helper layer guarantees one child at a time. Force/download
// success is TWO-PHASE: the helper's result is only stage 'result' — success
// is 'acf_confirmed' when the ACF watcher observes that item's
// timeupdated/manifest advance (120s timer => 'result_ok_unconfirmed').

const ACF_CONFIRM_TIMEOUT_MS = 120_000
const JOB_RETENTION = 200

export type ActionKind = 'subscribe' | 'unsubscribe' | 'download' | 'force' | 'sync' | 'syncAll'

export type ActionStage =
  | 'queued'
  | 'helper_starting'
  | 'subscribed'
  | 'downloading'
  | 'result'
  | 'acf_confirmed'
  | 'result_ok_unconfirmed'
  | 'failed'

export interface ActionJob {
  actionId: string
  kind: ActionKind
  appId: number
  modId?: string
  stage: ActionStage
  detail?: string
  error?: string
  ok?: boolean
  done: boolean
  queuePosition: number
  createdAtTs: number
  updatedAtTs: number
}

export class SteamNotRunningError extends Error {}

const now = (): number => Math.floor(Date.now() / 1000)

const jobs = new Map<string, ActionJob>()
const queue: ActionJob[] = []
let running: ActionJob | null = null
let pumping = false

export function getJob(actionId: string): ActionJob | undefined {
  return jobs.get(actionId)
}

function emit(job: ActionJob, stage: ActionStage, detail?: string): void {
  job.stage = stage
  if (detail !== undefined) job.detail = detail
  job.updatedAtTs = now()
  broadcastPoke('action', {
    actionId: job.actionId,
    stage,
    detail: job.detail,
    queuePosition: job.queuePosition,
  })
}

function finish(job: ActionJob, ok: boolean, stage: ActionStage, detail?: string): void {
  job.ok = ok
  job.done = true
  emit(job, stage, detail)
}

function trimJobs(): void {
  if (jobs.size <= JOB_RETENTION * 2) return
  const done = [...jobs.values()].filter(j => j.done).sort((a, b) => a.updatedAtTs - b.updatedAtTs)
  for (const j of done.slice(0, jobs.size - JOB_RETENTION)) jobs.delete(j.actionId)
}

/**
 * Validate + enqueue. Throws SteamNotRunningError (typed 409 upstream) after a
 * fresh steamRunning probe — helper launches without Steam always fail.
 */
export function enqueueAction(kind: ActionKind, appId: number, modId?: string): ActionJob {
  hub.steamRunning = isSteamRunning()
  if (!hub.steamRunning) throw new SteamNotRunningError()
  const job: ActionJob = {
    actionId: crypto.randomUUID(),
    kind,
    appId,
    modId,
    stage: 'queued',
    done: false,
    queuePosition: queue.length + (running ? 1 : 0),
    createdAtTs: now(),
    updatedAtTs: now(),
  }
  jobs.set(job.actionId, job)
  trimJobs()
  queue.push(job)
  emit(job, 'queued')
  void pump()
  return job
}

async function pump(): Promise<void> {
  if (pumping) return
  pumping = true
  try {
    for (;;) {
      const job = queue.shift()
      if (!job) return
      running = job
      job.queuePosition = 0
      for (let i = 0; i < queue.length; i++) queue[i].queuePosition = i + 1
      try {
        await runJob(job)
      } catch (e) {
        job.error =
          e instanceof HelperInitError
            ? `steam_not_running: ${e.message}`
            : String(e instanceof Error ? e.message : e)
        finish(job, false, 'failed')
      }
      running = null
    }
  } finally {
    pumping = false
    running = null
  }
}

// ---------------------------------------------------------------- ACF confirmation

const confirmWaiters = new Map<string, Array<() => void>>()

setAcfAdvanceHook(advances => {
  for (const a of advances) {
    const waiters = confirmWaiters.get(a.modId)
    if (!waiters) continue
    confirmWaiters.delete(a.modId)
    for (const w of waiters) w()
  }
})

/** Resolves true when the watcher sees this item's ACF advance; false on timeout. */
function waitForAcfConfirm(modId: string, timeoutMs = ACF_CONFIRM_TIMEOUT_MS): Promise<boolean> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      const list = confirmWaiters.get(modId)
      if (list) {
        const idx = list.indexOf(onConfirm)
        if (idx >= 0) list.splice(idx, 1)
        if (list.length === 0) confirmWaiters.delete(modId)
      }
      resolve(false)
    }, timeoutMs)
    const onConfirm = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    const list = confirmWaiters.get(modId) ?? []
    list.push(onConfirm)
    confirmWaiters.set(modId, list)
  })
}

// ---------------------------------------------------------------- job execution

/**
 * Zero-mod-game subscribe landing path (must-fix 18): insert a synthetic mod
 * record immediately (account: subscribed via the pending entry; remote meta
 * from a one-off GetPublishedFileDetails) so the UI shows it as not-installed;
 * the directory watcher promotes it when the appworkshop ACF appears.
 */
async function ensureSyntheticMeta(modId: string, appId: number): Promise<void> {
  const rec = ensureRecord(modId, appId)
  if (!rec.remote?.meta) {
    try {
      const fetched = await fetchPublishedFileDetails([modId])
      const r = fetched.get(modId)
      if (r && (r.status === 'ok' || r.status === 'banned')) {
        // first observation seeds lastSeenRemoteTs silently — no synthetic event
        if (r.timeUpdated) rec.lastSeenRemoteTs = r.timeUpdated
        rec.remote = {
          fetchStatus: r.status,
          remoteTs: r.timeUpdated,
          lastOkAt: now(),
          meta: metaFrom(r),
        }
      }
    } catch {
      // poller fills the meta in on its next pass
    }
  }
  await persistMods()
}

function describeResult(result: HelperResult): string {
  const bits: string[] = []
  if (typeof result.state === 'number') bits.push(`state=${result.state}`)
  if (typeof result.started === 'boolean') bits.push(`started=${result.started}`)
  if (typeof result.settled === 'boolean') bits.push(`settled=${result.settled}`)
  return bits.join(' ')
}

async function runModAction(job: ActionJob): Promise<void> {
  const { kind, appId } = job
  const modId = job.modId as string
  emit(job, 'helper_starting')
  const result = await runWithSession(appId, s =>
    s.request({ op: kind, modId }, 90_000, stage => {
      if (stage === 'subscribed') emit(job, 'subscribed')
      else if (stage === 'downloading') emit(job, 'downloading')
    }),
  )
  if (!result.ok) {
    job.error = result.error ?? 'helper failed'
    finish(job, false, 'failed')
    return
  }

  // account/record side effects (optimistic mutations, must-fix 10)
  if (kind === 'subscribe' || kind === 'force') {
    addPending(modId, appId)
    if (kind === 'subscribe') addToSubs(appId, modId)
    await ensureSyntheticMeta(modId, appId)
  } else if (kind === 'download') {
    addPending(modId, appId)
  } else if (kind === 'unsubscribe') {
    removeFromSubs(appId, modId)
  }
  broadcastPoke('state')
  setTimeout(() => void pollRemote(kind), 5_000).unref()

  if (kind === 'unsubscribe') {
    finish(job, true, 'result', describeResult(result))
    return
  }

  // Two-phase completion (must-fix 13): helper output is only 'result'; the
  // mod's state flips solely from the ACF diff, same as organic downloads.
  emit(job, 'result', describeResult(result))
  const confirmed = await waitForAcfConfirm(modId)
  if (confirmed) {
    finish(job, true, 'acf_confirmed')
  } else {
    finish(
      job,
      true,
      'result_ok_unconfirmed',
      'Steam accepted the request but no ACF change was observed within 120s. ' +
        'The download may be deferred until the game launches, or Steam may be busy.',
    )
  }
}

async function runSync(job: ActionJob): Promise<void> {
  emit(job, 'helper_starting')
  const count = await syncViaSession(job.appId)
  setTimeout(() => void pollRemote('sync'), 2_000).unref()
  finish(job, true, 'result', `${count} subscriptions`)
}

function syncAllTargets(): number[] {
  return hub.games
    .filter(g => g.installed && (g.workshop || g.hasWorkshopAcf))
    .map(g => g.appId)
}

async function runSyncAll(job: ActionJob): Promise<void> {
  const targets = syncAllTargets()
  if (targets.length === 0) {
    finish(job, true, 'result', 'no installed workshop games')
    return
  }
  const errors: string[] = []
  let done = 0
  for (const appId of targets) {
    emit(job, 'helper_starting', `app ${appId} (${done + 1}/${targets.length})`)
    try {
      const count = await syncViaSession(appId)
      job.detail = `app ${appId}: ${count} subscriptions (${done + 1}/${targets.length})`
    } catch (e) {
      errors.push(`${appId}: ${String(e instanceof Error ? e.message : e)}`)
    }
    done++
  }
  setTimeout(() => void pollRemote('syncAll'), 2_000).unref()
  if (errors.length === targets.length) {
    job.error = errors.join('; ')
    finish(job, false, 'failed')
  } else {
    finish(
      job,
      true,
      'result',
      `synced ${targets.length - errors.length}/${targets.length} games` +
        (errors.length > 0 ? ` (failed: ${errors.join('; ')})` : ''),
    )
  }
}

async function runJob(job: ActionJob): Promise<void> {
  switch (job.kind) {
    case 'sync':
      await runSync(job)
      break
    case 'syncAll':
      await runSyncAll(job)
      break
    default:
      await runModAction(job)
  }
}
