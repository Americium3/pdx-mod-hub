import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Request, Response } from 'express'
import { DATA_DIR } from './config.js'

const CACHE_DIR = path.join(DATA_DIR, 'imgcache')
const MAX_CACHE_BYTES = 400 * 1024 * 1024

const ALLOWED_HOSTS = [
  'images.steamusercontent.com',
  'steamuserimages-a.akamaihd.net',
  'cdn.akamai.steamstatic.com',
  'shared.akamai.steamstatic.com',
]

function allowed(u: URL): boolean {
  return u.protocol === 'https:' && ALLOWED_HOSTS.some(h => u.hostname === h)
}

export async function serveImage(req: Request, res: Response): Promise<void> {
  const raw = String(req.query.u ?? '')
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    res.status(400).end()
    return
  }
  if (!allowed(url)) {
    res.status(403).end()
    return
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const key = crypto.createHash('sha1').update(url.href).digest('hex')
  const file = path.join(CACHE_DIR, key)
  if (fs.existsSync(file)) {
    res.setHeader('Cache-Control', 'public, max-age=604800')
    res.setHeader('Content-Type', 'image/jpeg')
    fs.createReadStream(file).pipe(res)
    return
  }
  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!upstream.ok || !upstream.body) {
      res.status(502).end()
      return
    }
    const buf = Buffer.from(await upstream.arrayBuffer())
    fs.writeFileSync(file, buf)
    res.setHeader('Cache-Control', 'public, max-age=604800')
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'image/jpeg')
    res.end(buf)
  } catch {
    res.status(502).end()
  }
}

export function pruneImageCache(): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) return
    const files = fs
      .readdirSync(CACHE_DIR)
      .map(f => {
        const full = path.join(CACHE_DIR, f)
        const st = fs.statSync(full)
        return { full, size: st.size, atime: st.atimeMs }
      })
      .sort((a, b) => a.atime - b.atime)
    let total = files.reduce((s, f) => s + f.size, 0)
    for (const f of files) {
      if (total <= MAX_CACHE_BYTES) break
      fs.unlinkSync(f.full)
      total -= f.size
    }
  } catch {
    // cache pruning is best-effort
  }
}
