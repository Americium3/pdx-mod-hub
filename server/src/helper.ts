import { spawn } from 'node:child_process'
import { HELPER_SCRIPT } from './config.js'
import { broadcast } from './sse.js'

export interface HelperResult {
  ok: boolean
  error?: string
  [key: string]: unknown
}

// One helper at a time: each run inits Steamworks under a game appid, which makes
// Steam briefly show that game as "in-game". Keep runs short, serial, on-demand only.
let chain: Promise<unknown> = Promise.resolve()

export function runHelper(
  cmd: string,
  appId: number,
  args: string[] = [],
  timeoutMs = 90_000,
): Promise<HelperResult> {
  const run = async (): Promise<HelperResult> => {
    broadcast('helper', { busy: true, cmd, appId })
    try {
      return await new Promise<HelperResult>(resolve => {
        const child = spawn(process.execPath, [HELPER_SCRIPT, cmd, String(appId), ...args], {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        let out = ''
        let err = ''
        let done = false
        const finish = (result: HelperResult): void => {
          if (done) return
          done = true
          clearTimeout(timer)
          resolve(result)
        }
        const timer = setTimeout(() => {
          child.kill()
          finish({ ok: false, error: `helper timeout after ${timeoutMs}ms` })
        }, timeoutMs)
        child.stdout.on('data', d => (out += d))
        child.stderr.on('data', d => (err += d))
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
    } finally {
      broadcast('helper', { busy: false, cmd, appId })
    }
  }
  const next = chain.then(run, run)
  chain = next.catch(() => undefined)
  return next
}
