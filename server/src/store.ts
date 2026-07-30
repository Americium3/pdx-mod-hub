import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

// JSON store: in-memory state is authoritative; this module only makes writes durable.
// Per-file async mutex serializes read-modify-write; writes are same-dir unique temp +
// fsync + rename (with EPERM/EBUSY retries for AV/indexer locks); loads fall back
// parse -> .bak -> default.

const queues = new Map<string, Promise<unknown>>()

export function withFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(file)
  const prev = queues.get(key) ?? Promise.resolve()
  const next = prev.then(fn, fn)
  queues.set(
    key,
    next.catch(() => undefined),
  )
  return next
}

function tryParse<T>(file: string): { ok: boolean; value?: T } {
  try {
    return { ok: true, value: JSON.parse(fs.readFileSync(file, 'utf8')) as T }
  } catch {
    return { ok: false }
  }
}

export function readJson<T>(file: string, fallback: T): T {
  const main = tryParse<T>(file)
  if (main.ok) return main.value as T
  const bak = tryParse<T>(`${file}.bak`)
  if (bak.ok) {
    if (fs.existsSync(file)) {
      console.warn(`[store] ${path.basename(file)} unreadable; recovered from .bak`)
    }
    return bak.value as T
  }
  return fallback
}

const RENAME_RETRIES = 5
const RENAME_RETRY_MS = 100

async function atomicWrite(file: string, text: string): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`
  const fh = await fsp.open(tmp, 'w')
  try {
    await fh.writeFile(text, 'utf8')
    await fh.sync()
  } finally {
    await fh.close()
  }
  try {
    await fsp.copyFile(file, `${file}.bak`)
  } catch {
    // first write for this file: no .bak yet
  }
  let lastErr: unknown
  for (let attempt = 0; attempt < RENAME_RETRIES; attempt++) {
    try {
      await fsp.rename(tmp, file)
      return
    } catch (e) {
      lastErr = e
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EBUSY') break
      await new Promise(r => setTimeout(r, RENAME_RETRY_MS))
    }
  }
  await fsp.unlink(tmp).catch(() => undefined)
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr))
}

export function writeJson(file: string, data: unknown): Promise<void> {
  const text = JSON.stringify(data, null, 2)
  return withFileLock(file, () => atomicWrite(file, text)).catch(e => {
    console.error(`[store] failed to write ${path.basename(file)}: ${String(e)}`)
  })
}

/** Await all queued writes (call before an explicit process.exit). */
export async function flushStores(): Promise<void> {
  await Promise.all([...queues.values()])
}
